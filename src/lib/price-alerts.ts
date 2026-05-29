import crypto from 'crypto';

export type AlertType = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered' | 'inactive';

export interface AlertHistoryRecord {
  timestamp: number;
  priceAtTrigger: number;
  notificationSent: boolean;
}

export interface AlertAnalytics {
  totalAlerts: number;
  activeAlerts: number;
  triggeredAlerts: number;
  inactiveAlerts: number;
  totalTriggerCount: number;
  mostTriggeredCurrency: string | null;
  averageTriggersPerAlert: number;
}

export interface PriceAlert {
  id: string;
  currency: string;
  targetPrice: number;
  alertType: AlertType;
  status: AlertStatus;
  createdAt: number;
  triggeredAt?: number;
  notificationSent: boolean;
  triggeredCount: number;
  /** History of past trigger events */
  triggerHistory: AlertHistoryRecord[];
  /** Whether to re-arm after triggering (persist as active) */
  recurring: boolean;
  userAddress?: string;
}

export class PriceAlertStorage {
  private static readonly STORAGE_KEY = 'stellar_spend_price_alerts';
  private static readonly POLL_INTERVAL = 60000;
  private static pollingInterval: NodeJS.Timeout | null = null;

  static createAlert(
    alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggeredAt' | 'notificationSent' | 'triggerHistory'>,
  ): PriceAlert {
    const id = crypto.randomUUID();
    const saved: PriceAlert = {
      ...alert,
      id,
      createdAt: Date.now(),
      notificationSent: false,
      triggeredCount: 0,
      triggerHistory: [],
      recurring: alert.recurring ?? false,
    };

    const alerts = this.getAllAlerts();
    alerts.push(saved);
    this.persistAlerts(alerts);
    return saved;
  }

  static getAlert(id: string): PriceAlert | null {
    const alerts = this.getAllAlerts();
    return alerts.find((a) => a.id === id) || null;
  }

  static getAllAlerts(): PriceAlert[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  static getActiveAlerts(): PriceAlert[] {
    return this.getAllAlerts().filter((a) => a.status === 'active');
  }

  static getAlertsByUser(userAddress: string): PriceAlert[] {
    const lower = userAddress.toLowerCase();
    return this.getAllAlerts().filter((a) => a.userAddress?.toLowerCase() === lower);
  }

  static deleteAlert(id: string): boolean {
    const alerts = this.getAllAlerts();
    const filtered = alerts.filter((a) => a.id !== id);
    if (filtered.length === alerts.length) return false;
    this.persistAlerts(filtered);
    return true;
  }

  static updateAlert(
    id: string,
    updates: Partial<Omit<PriceAlert, 'id' | 'createdAt'>>,
  ): PriceAlert | null {
    const alerts = this.getAllAlerts();
    const index = alerts.findIndex((a) => a.id === id);
    if (index === -1) return null;

    alerts[index] = { ...alerts[index], ...updates };
    this.persistAlerts(alerts);
    return alerts[index];
  }

  static getAlertHistory(id: string): AlertHistoryRecord[] {
    const alert = this.getAlert(id);
    return alert?.triggerHistory ?? [];
  }

  static getAnalytics(): AlertAnalytics {
    const all = this.getAllAlerts();

    const triggersByCurrency: Record<string, number> = {};
    let totalTriggerCount = 0;

    for (const alert of all) {
      totalTriggerCount += alert.triggeredCount;
      if (alert.triggeredCount > 0) {
        triggersByCurrency[alert.currency] = (triggersByCurrency[alert.currency] ?? 0) + alert.triggeredCount;
      }
    }

    const entries = Object.entries(triggersByCurrency);
    const mostTriggeredCurrency =
      entries.length > 0
        ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        : null;

    return {
      totalAlerts: all.length,
      activeAlerts: all.filter((a) => a.status === 'active').length,
      triggeredAlerts: all.filter((a) => a.status === 'triggered').length,
      inactiveAlerts: all.filter((a) => a.status === 'inactive').length,
      totalTriggerCount,
      mostTriggeredCurrency,
      averageTriggersPerAlert: all.length > 0 ? totalTriggerCount / all.length : 0,
    };
  }

  static checkAlerts(
    currentPrices: Record<string, number>,
    onNotify?: (alert: PriceAlert, price: number) => void,
  ): PriceAlert[] {
    const alerts = this.getActiveAlerts();
    const triggered: PriceAlert[] = [];

    alerts.forEach((alert) => {
      const currentPrice = currentPrices[alert.currency];
      if (currentPrice === undefined) return;

      const shouldTrigger =
        (alert.alertType === 'above' && currentPrice >= alert.targetPrice) ||
        (alert.alertType === 'below' && currentPrice <= alert.targetPrice);

      if (shouldTrigger && !alert.notificationSent) {
        const historyRecord: AlertHistoryRecord = {
          timestamp: Date.now(),
          priceAtTrigger: currentPrice,
          notificationSent: true,
        };

        const nextStatus: AlertStatus = alert.recurring ? 'active' : 'triggered';
        this.updateAlert(alert.id, {
          status: nextStatus,
          triggeredAt: Date.now(),
          notificationSent: !alert.recurring,
          triggeredCount: (alert.triggeredCount ?? 0) + 1,
          triggerHistory: [historyRecord, ...(alert.triggerHistory ?? [])].slice(0, 50),
        });

        triggered.push(alert);
        if (onNotify) onNotify(alert, currentPrice);
      }
    });

    return triggered;
  }

  static startMonitoring(
    onAlert: (alerts: PriceAlert[]) => void,
    getPrices: () => Promise<Record<string, number>>,
  ) {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      try {
        const prices = await getPrices();
        const triggered = this.checkAlerts(prices);
        if (triggered.length > 0) {
          onAlert(triggered);
        }
      } catch (error) {
        console.error('Price alert check failed:', error);
      }
    }, this.POLL_INTERVAL);
  }

  static stopMonitoring() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private static persistAlerts(alerts: PriceAlert[]): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(alerts));
    }
  }
}
