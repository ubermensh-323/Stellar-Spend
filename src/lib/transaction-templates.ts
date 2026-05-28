import crypto from 'crypto';

export interface TransactionTemplate {
  id: string;
  name: string;
  amount: string;
  currency: string;
  beneficiaryId?: string;
  feeMethod: 'XLM' | 'USDC';
  category: string;
  usageCount: number;
  createdAt: number;
  lastUsed?: number;
  note?: string;
}

export class TemplateStorage {
  private static readonly STORAGE_KEY = 'stellar_spend_templates';

  static createTemplate(template: Omit<TransactionTemplate, 'id' | 'createdAt'>): TransactionTemplate {
    const id = crypto.randomUUID();
    const saved: TransactionTemplate = {
      ...template,
      id,
      createdAt: Date.now(),
      category: template.category ?? 'General',
      usageCount: template.usageCount ?? 0,
    };

    const templates = this.getAllTemplates();
    templates.push(saved);
    this.persistTemplates(templates);
    return saved;
  }

  static getTemplate(id: string): TransactionTemplate | null {
    const templates = this.getAllTemplates();
    return templates.find(t => t.id === id) || null;
  }

  static getAllTemplates(): TransactionTemplate[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  static deleteTemplate(id: string): boolean {
    const templates = this.getAllTemplates();
    const filtered = templates.filter(t => t.id !== id);
    if (filtered.length === templates.length) return false;
    this.persistTemplates(filtered);
    return true;
  }

  static updateTemplate(id: string, updates: Partial<Omit<TransactionTemplate, 'id' | 'createdAt'>>): TransactionTemplate | null {
    const templates = this.getAllTemplates();
    const index = templates.findIndex(t => t.id === id);
    if (index === -1) return null;

    templates[index] = { ...templates[index], ...updates };
    this.persistTemplates(templates);
    return templates[index];
  }

  static recordUsage(id: string): void {
    const t = this.getTemplate(id);
    this.updateTemplate(id, {
      lastUsed: Date.now(),
      usageCount: (t?.usageCount ?? 0) + 1,
    });
  }

  static getRecentTemplates(limit: number = 5): TransactionTemplate[] {
    return this.getAllTemplates()
      .sort((a, b) => (b.lastUsed || b.createdAt) - (a.lastUsed || a.createdAt))
      .slice(0, limit);
  }

  private static persistTemplates(templates: TransactionTemplate[]): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
    }
  }
}
