'use client';

import { useState, useRef } from 'react';
import { SharePlatform } from '@/types/sharing';

interface ShareButtonsProps {
  shareUrl: string;
  amount: string;
  currency: string;
  txHash?: string;
  recipientBank?: string;
  onShare?: (platform: SharePlatform) => void;
}

interface PrivacySettings {
  includeAmount: boolean;
  includeCurrency: boolean;
}

interface ShareAnalytics {
  platform: SharePlatform;
  timestamp: number;
}

const ANALYTICS_KEY = 'stellar_share_analytics';

function trackShare(platform: SharePlatform): void {
  try {
    const existing: ShareAnalytics[] = JSON.parse(
      localStorage.getItem(ANALYTICS_KEY) ?? '[]'
    );
    existing.push({ platform, timestamp: Date.now() });
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(existing.slice(-100)));
  } catch {
    // ignore storage errors
  }
}

export function getShareAnalytics(): Record<SharePlatform, number> {
  try {
    const entries: ShareAnalytics[] = JSON.parse(
      localStorage.getItem(ANALYTICS_KEY) ?? '[]'
    );
    return entries.reduce(
      (acc, { platform }) => ({ ...acc, [platform]: (acc[platform] ?? 0) + 1 }),
      {} as Record<SharePlatform, number>
    );
  } catch {
    return {} as Record<SharePlatform, number>;
  }
}

/** Generate a receipt image as a data URL using Canvas API */
function generateReceiptImage(
  amount: string,
  currency: string,
  txHash: string | undefined,
  recipientBank: string | undefined,
  privacy: PrivacySettings
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 280;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Gold border
  ctx.strokeStyle = '#c9a962';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  // Title
  ctx.fillStyle = '#c9a962';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('STELLAR-SPEND', 32, 48);

  ctx.fillStyle = '#555555';
  ctx.font = '10px monospace';
  ctx.fillText('TRANSACTION RECEIPT', 32, 66);

  // Divider
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 78);
  ctx.lineTo(canvas.width - 32, 78);
  ctx.stroke();

  let y = 104;
  const labelX = 32;
  const valueX = 200;

  const row = (label: string, value: string, highlight = false) => {
    ctx.fillStyle = '#555555';
    ctx.font = '10px monospace';
    ctx.fillText(label, labelX, y);
    ctx.fillStyle = highlight ? '#c9a962' : '#ffffff';
    ctx.font = highlight ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText(value, valueX, y);
    y += 26;
  };

  if (privacy.includeAmount) row('AMOUNT', `${amount}${privacy.includeCurrency ? ` ${currency}` : ''}`, true);
  else if (privacy.includeCurrency) row('CURRENCY', currency);

  if (txHash) row('TX HASH', `${txHash.slice(0, 8)}...${txHash.slice(-6)}`);
  if (recipientBank) row('RECIPIENT', recipientBank);
  row('DATE', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
  row('STATUS', '✓ COMPLETED');

  // Footer
  ctx.fillStyle = '#333333';
  ctx.font = '9px monospace';
  ctx.fillText('stellar-spend.app', 32, canvas.height - 24);

  return canvas.toDataURL('image/png');
}

export function ShareButtons({ shareUrl, amount, currency, txHash, recipientBank, onShare }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [imageGenerated, setImageGenerated] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacySettings>({
    includeAmount: true,
    includeCurrency: true,
  });
  const imgLinkRef = useRef<HTMLAnchorElement>(null);

  const buildShareText = () => {
    const parts: string[] = ['I just completed a transaction'];
    if (privacy.includeAmount) parts.push(`of ${amount}`);
    if (privacy.includeCurrency) parts.push(privacy.includeAmount ? currency : `(${currency})`);
    parts.push('using Stellar-Spend! 🚀');
    return parts.join(' ');
  };

  const shareText = buildShareText();

  const platforms = [
    {
      id: 'twitter' as SharePlatform,
      label: 'Twitter/X',
      color: 'bg-black hover:bg-zinc-800',
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: 'facebook' as SharePlatform,
      label: 'Facebook',
      color: 'bg-blue-600 hover:bg-blue-700',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: 'linkedin' as SharePlatform,
      label: 'LinkedIn',
      color: 'bg-blue-700 hover:bg-blue-800',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: 'email' as SharePlatform,
      label: 'Email',
      color: 'bg-gray-600 hover:bg-gray-700',
      url: `mailto:?subject=Check out my Stellar-Spend transaction&body=${encodeURIComponent(
        `${shareText}\n\nView details: ${shareUrl}`
      )}`,
    },
  ];

  const handleShare = (platform: SharePlatform, url: string) => {
    trackShare(platform);
    onShare?.(platform);
    window.open(url, '_blank', 'width=600,height=400');
  };

  const handleCopy = () => {
    trackShare('copy');
    onShare?.('copy');
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadReceipt = () => {
    const dataUrl = generateReceiptImage(amount, currency, txHash, recipientBank, privacy);
    const a = imgLinkRef.current ?? document.createElement('a');
    a.href = dataUrl;
    a.download = `stellar-spend-receipt-${Date.now()}.png`;
    a.click();
    setImageGenerated(true);
    setTimeout(() => setImageGenerated(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Share this transaction</p>
        <button
          onClick={() => setShowPrivacy((v) => !v)}
          className="text-xs text-[#c9a962] hover:underline"
          aria-expanded={showPrivacy}
        >
          {showPrivacy ? 'Hide' : 'Privacy'} settings
        </button>
      </div>

      {/* Privacy controls */}
      {showPrivacy && (
        <div className="p-3 border border-[#333333] bg-[#111111] space-y-2 text-xs">
          <p className="text-[#777777] uppercase tracking-widest text-[10px]">Privacy Controls</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={privacy.includeAmount}
              onChange={(e) => setPrivacy((p) => ({ ...p, includeAmount: e.target.checked }))}
              className="accent-[#c9a962]"
            />
            <span className="text-[#aaaaaa]">Include transaction amount</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={privacy.includeCurrency}
              onChange={(e) => setPrivacy((p) => ({ ...p, includeCurrency: e.target.checked }))}
              className="accent-[#c9a962]"
            />
            <span className="text-[#aaaaaa]">Include currency</span>
          </label>
          <p className="text-[#555555] italic">Preview: {shareText}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {platforms.map((platform) => (
          <button
            key={platform.id}
            onClick={() => handleShare(platform.id, platform.url)}
            className={`${platform.color} text-white px-3 py-2 rounded-lg text-sm font-medium transition`}
            title={`Share on ${platform.label}`}
          >
            {platform.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={shareUrl}
          readOnly
          className="flex-1 px-3 py-2 border border-[#333333] rounded-lg text-sm bg-[#111111] text-[#aaaaaa]"
        />
        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-[#c9a962] text-[#0a0a0a] rounded-lg text-sm font-medium hover:bg-[#d4b574] transition"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Receipt image download */}
      <button
        onClick={handleDownloadReceipt}
        className="w-full px-4 py-2 border border-[#333333] text-[#aaaaaa] text-sm hover:border-[#c9a962] hover:text-[#c9a962] transition rounded-lg"
      >
        {imageGenerated ? '✓ Receipt Downloaded' : '⬇ Download Receipt Image'}
      </button>
      {/* Hidden anchor for download */}
      <a ref={imgLinkRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
