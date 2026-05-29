export interface Transaction {
  id: string;
  timestamp: number;
  finalizedAt?: number;
  userAddress: string;
  amount: string;
  currency: string;
  feeMethod?: 'native' | 'stablecoin';
  bridgeFee?: string;
  networkFee?: string;
  paycrestFee?: string;
  totalFee?: string;
  stellarTxHash?: string;
  bridgeStatus?: string;
  payoutOrderId?: string;
  payoutStatus?: string;
  beneficiary: {
    institution: string;
    accountIdentifier: string;
    accountName: string;
    currency: string;
  };
  status: 'pending' | 'completed' | 'failed' | 'reversed' | 'partially_reversed';
  error?: string;
  /** User-supplied note for this transaction (max 500 chars) */
  note?: string;
  /** Tags for organizing transactions */
  tags?: Array<{ id: string; name: string; color: string }>;
  /** Reversal information */
  reversal?: {
    id: string;
    timestamp: number;
    amount: string;
    reason: string;
    status: 'pending' | 'completed' | 'failed';
  };
  /** Whether this transaction is marked as favorite */
  isFavorite?: boolean;
  /** Transaction insurance policy attached to this transaction */
  insurance?: {
    id?: string;
    premium: number;
    coverage: number;
    provider: string;
    riskScore: number;
    status: 'pending' | 'active' | 'claimed' | 'claim_approved' | 'claim_rejected' | 'paid';
    claimId?: string;
    claimReason?: string;
    purchasedAt: number;
  };
}

const STORAGE_KEY = 'stellar_spend_transactions';
const MAX_TRANSACTIONS = 50;

export class TransactionStorage {
  static save(transaction: Transaction): void {
    if (typeof window === 'undefined') return;
    const all = this.getAll();
    all.unshift(transaction);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_TRANSACTIONS)));
  }

  static update(id: string, updates: Partial<Transaction>): void {
    if (typeof window === 'undefined') return;
    const all = this.getAll();
    const i = all.findIndex(tx => tx.id === id);
    if (i !== -1) {
      all[i] = { ...all[i], ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  }

  static getAll(): Transaction[] {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  static getByUser(userAddress: string): Transaction[] {
    return this.getAll().filter(tx => tx.userAddress.toLowerCase() === userAddress.toLowerCase());
  }

  static getById(id: string): Transaction | undefined {
    return this.getAll().find(tx => tx.id === id);
  }

  static clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }

  static updateNote(id: string, note: string): void {
    this.update(id, { note: note.slice(0, 500) });
  }

  static generateId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  static isReversalEligible(tx: Transaction): boolean {
    return tx.status === 'completed' && !tx.reversal;
  }

  static reverse(id: string, amount: string, reason: string): void {
    const tx = this.getById(id);
    if (!tx || !this.isReversalEligible(tx)) return;
    
    this.update(id, {
      reversal: {
        id: `rev_${Date.now()}`,
        timestamp: Date.now(),
        amount,
        reason,
        status: 'pending',
      },
      status: parseFloat(amount) === parseFloat(tx.amount) ? 'reversed' : 'partially_reversed',
    });
  }

  static updateReversalStatus(id: string, status: 'pending' | 'completed' | 'failed'): void {
    const tx = this.getById(id);
    if (!tx?.reversal) return;
    
    this.update(id, {
      reversal: { ...tx.reversal, status },
    });
  }

  static toggleFavorite(id: string): void {
    const tx = this.getById(id);
    if (!tx) return;
    this.update(id, { isFavorite: !tx.isFavorite });
  }

  static getFavorites(): Transaction[] {
    return this.getAll().filter(tx => tx.isFavorite);
  }

  static getFavoritesByUser(userAddress: string): Transaction[] {
    return this.getByUser(userAddress).filter(tx => tx.isFavorite);
  }

  /**
   * Apply an update locally and return a rollback function that restores
   * the previous values. Use when the caller is also issuing a network
   * request and wants to revert the local change if it fails.
   */
  static applyOptimistic(id: string, updates: Partial<Transaction>): () => void {
    const prior = this.getById(id);
    if (!prior) return () => {};
    const snapshot: Partial<Transaction> = {};
    for (const key of Object.keys(updates) as Array<keyof Transaction>) {
      // Save the previous value for every key being changed so rollback is exact.
      (snapshot as Record<string, unknown>)[key] = prior[key];
    }
    this.update(id, updates);
    return () => this.update(id, snapshot);
  }

  static addTag(id: string, tagName: string, color: string = '#3b82f6'): void {
    const tx = this.getById(id);
    if (!tx) return;
    const tags = tx.tags || [];
    const tagId = `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    tags.push({ id: tagId, name: tagName, color });
    this.update(id, { tags });
  }

  static removeTag(id: string, tagId: string): void {
    const tx = this.getById(id);
    if (!tx?.tags) return;
    this.update(id, { tags: tx.tags.filter(t => t.id !== tagId) });
  }

  static getTransactionsByTag(tagName: string): Transaction[] {
    return this.getAll().filter(tx => tx.tags?.some(t => t.name === tagName));
  }

  static getAllTags(): Array<{ name: string; color: string; count: number }> {
    const tagMap = new Map<string, { color: string; count: number }>();
    this.getAll().forEach(tx => {
      tx.tags?.forEach(tag => {
        const existing = tagMap.get(tag.name);
        tagMap.set(tag.name, {
          color: tag.color,
          count: (existing?.count || 0) + 1,
        });
      });
    });
    return Array.from(tagMap.entries()).map(([name, { color, count }]) => ({
      name,
      color,
      count,
    }));
  }
}
