'use client';

import { useState, useEffect } from 'react';
import { TemplateStorage, TransactionTemplate } from '@/lib/transaction-templates';
import { Button } from '@/components/design-system/Button';
import { Card } from '@/components/design-system/Card';

interface TemplateManagerProps {
  onSelectTemplate?: (template: TransactionTemplate) => void;
}

const CATEGORIES = ['General', 'Rent', 'Family', 'Business', 'Savings'];

const EMPTY_FORM = {
  name: '',
  amount: '',
  currency: 'NGN',
  feeMethod: 'USDC' as 'XLM' | 'USDC',
  category: 'General',
  note: '',
};

function TemplatePreview({ template }: { template: TransactionTemplate }) {
  return (
    <div className="text-xs text-gray-500 space-y-0.5 mt-1">
      <span className="inline-block bg-gray-200 dark:bg-gray-700 rounded px-1.5 py-0.5 mr-1">{template.category}</span>
      <span>{template.amount} {template.currency}</span>
      {template.note && <span className="ml-2 italic">"{template.note}"</span>}
      <span className="ml-2">· used {template.usageCount ?? 0}×</span>
    </div>
  );
}

function shareTemplate(template: TransactionTemplate) {
  const text = `Stellar-Spend template: ${template.name} — ${template.amount} ${template.currency} (${template.feeMethod} fee)`;
  if (navigator.share) {
    navigator.share({ title: template.name, text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).catch(() => {});
    alert('Template details copied to clipboard!');
  }
}

export function TemplateManager({ onSelectTemplate }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<TransactionTemplate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [formData, setFormData] = useState(EMPTY_FORM);

  const refresh = () => setTemplates(TemplateStorage.getAllTemplates());

  useEffect(() => { refresh(); }, []);

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    if (editingId) {
      TemplateStorage.updateTemplate(editingId, formData);
      setEditingId(null);
    } else {
      TemplateStorage.createTemplate({ ...formData, usageCount: 0 });
    }
    refresh();
    setFormData(EMPTY_FORM);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    TemplateStorage.deleteTemplate(id);
    refresh();
  };

  const handleUse = (template: TransactionTemplate) => {
    TemplateStorage.recordUsage(template.id);
    refresh();
    onSelectTemplate?.(template);
  };

  const handleEdit = (template: TransactionTemplate) => {
    setFormData({
      name: template.name,
      amount: template.amount,
      currency: template.currency,
      feeMethod: template.feeMethod,
      category: template.category ?? 'General',
      note: template.note ?? '',
    });
    setEditingId(template.id);
    setShowForm(true);
  };

  const displayed = templates
    .filter(t => filterCategory === 'All' || t.category === filterCategory)
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Transaction Templates</h3>
        <span className="text-xs text-gray-500">{templates.length} saved</span>
      </div>

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap mb-3">
        {['All', ...CATEGORIES].map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`text-xs px-2 py-0.5 rounded-full border ${filterCategory === cat ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="space-y-2 mb-4">
        {displayed.length === 0 && (
          <p className="text-sm text-gray-500">No templates{filterCategory !== 'All' ? ` in "${filterCategory}"` : ''}.</p>
        )}
        {displayed.map(t => (
          <div key={t.id} className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{t.name}</p>
                <TemplatePreview template={t} />
              </div>
              <div className="flex gap-1 shrink-0 ml-2">
                <Button onClick={() => handleUse(t)} size="sm">Use</Button>
                <Button onClick={() => handleEdit(t)} variant="secondary" size="sm">Edit</Button>
                <button onClick={() => shareTemplate(t)} className="text-blue-500 hover:text-blue-700 px-1 text-sm" title="Share">⬆</button>
                <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700 px-1 text-sm">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm ? (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Template Name"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-2 border rounded text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Amount"
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              className="p-2 border rounded text-sm"
            />
            <select
              value={formData.currency}
              onChange={e => setFormData({ ...formData, currency: e.target.value })}
              className="p-2 border rounded text-sm"
            >
              <option value="NGN">NGN</option>
              <option value="KES">KES</option>
              <option value="GHS">GHS</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={formData.feeMethod}
              onChange={e => setFormData({ ...formData, feeMethod: e.target.value as 'XLM' | 'USDC' })}
              className="p-2 border rounded text-sm"
            >
              <option value="USDC">USDC Fee</option>
              <option value="XLM">XLM Fee</option>
            </select>
            <select
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              className="p-2 border rounded text-sm"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <input
            type="text"
            placeholder="Note (optional)"
            value={formData.note}
            onChange={e => setFormData({ ...formData, note: e.target.value })}
            className="w-full p-2 border rounded text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            <Button onClick={() => { setShowForm(false); setEditingId(null); setFormData(EMPTY_FORM); }} variant="secondary">Cancel</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowForm(true)}>+ New Template</Button>
      )}
    </Card>
  );
}
