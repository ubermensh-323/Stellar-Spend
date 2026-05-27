# Internationalization (i18n) Guide

This guide documents how the i18n system works in Stellar-Spend and how to add new languages, translations, and locale-specific formatting.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Translation File Structure](#translation-file-structure)
4. [Using Translations in Components](#using-translations-in-components)
5. [Adding a New Language](#adding-a-new-language)
6. [RTL Language Support](#rtl-language-support)
7. [Pluralization Rules](#pluralization-rules)
8. [Date and Number Formatting](#date-and-number-formatting)
9. [Language Detection Strategy](#language-detection-strategy)
10. [Testing Translations](#testing-translations)

---

## Architecture Overview

Stellar-Spend uses a custom, lightweight i18n system built with React Context. It has no external runtime dependencies and lives entirely in `src/lib/i18n/`.

```
I18n class (i18n.ts)
    │  holds translations map, current language, and lookup logic
    │
I18nProvider (provider.tsx)
    │  wraps the app; exposes language, setLanguage, t(), isRTL
    │
useI18n hook (provider.tsx)
    │  consumed by every component that needs a translated string
    │
LanguageSelector (LanguageSelector.tsx)
    │  UI component; calls setLanguage on click
    │
translations.ts
    │  one exported const per language (en, es, fr, zh, ar)
    │
types.ts
       TranslationKeys interface (single source of truth for key shape)
       Language union type ('en' | 'es' | 'fr' | 'zh' | 'ar')
```

**Key design choices:**

- Translation keys use dot-notation (`offramp.enterAmount`) resolved at runtime by splitting on `.`.
- If a key is missing in a translation file, `t()` returns the raw key string — this makes missing keys visible without crashing.
- RTL detection is centralised in `I18n.isRTL()` which currently returns `true` only for `'ar'`.

---

## Directory Structure

```
src/lib/i18n/
├── i18n.ts              # I18n class + singleton instance
├── index.ts             # Public re-exports
├── LanguageSelector.tsx # Drop-in UI component
├── provider.tsx         # I18nProvider + useI18n hook
├── translations.ts      # All translation strings (en, es, fr, zh, ar)
└── types.ts             # Language union type + TranslationKeys interface
```

---

## Translation File Structure

All translations live in `src/lib/i18n/translations.ts`. Each language exports a constant that satisfies the `TranslationKeys` interface defined in `types.ts`.

### TranslationKeys shape

```ts
interface TranslationKeys {
  common: {
    loading: string;
    error: string;
    success: string;
    cancel: string;
    submit: string;
    close: string;
  };
  navigation: {
    home: string;
    history: string;
    settings: string;
  };
  offramp: {
    title: string;
    enterAmount: string;
    selectCurrency: string;
    selectBank: string;
    accountNumber: string;
    estimatedTime: string;
    fees: string;
    total: string;
  };
  errors: {
    invalidAmount: string;
    insufficientBalance: string;
    networkError: string;
    transactionFailed: string;
  };
}
```

### Supported languages

| Code | Language  | RTL |
|------|-----------|-----|
| `en` | English   | No  |
| `es` | Spanish   | No  |
| `fr` | French    | No  |
| `zh` | Chinese   | No  |
| `ar` | Arabic    | Yes |

### Adding a key to an existing language

1. Add the property to the `TranslationKeys` interface in `types.ts`.
2. Add the key/value to every language object in `translations.ts`.

TypeScript will report a compile error for any language that is missing the new key, so coverage gaps are caught at build time.

---

## Using Translations in Components

### Wrap your app in `I18nProvider`

```tsx
// src/app/layout.tsx (or equivalent root layout)
import { I18nProvider } from '@/lib/i18n';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <I18nProvider defaultLanguage="en">
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
```

### Consume translations with `useI18n`

```tsx
'use client';

import { useI18n } from '@/lib/i18n';

export function SubmitButton() {
  const { t } = useI18n();

  return <button type="submit">{t('common.submit')}</button>;
}
```

### Apply RTL layout direction

```tsx
'use client';

import { useI18n } from '@/lib/i18n';

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const { isRTL } = useI18n();

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className={isRTL ? 'font-arabic' : ''}>
      {children}
    </div>
  );
}
```

### Drop-in language switcher

```tsx
import { LanguageSelector } from '@/lib/i18n';

// Place anywhere inside I18nProvider
<LanguageSelector />
```

The `LanguageSelector` component automatically reverses its own flex direction when `isRTL` is `true`.

### Using the singleton outside React

For non-component code (e.g., utility functions, server-side logic) that needs a translated string, use the singleton directly:

```ts
import { i18n } from '@/lib/i18n';

i18n.setLanguage('fr');
const msg = i18n.t('errors.networkError'); // 'Erreur réseau'
```

---

## Adding a New Language

### Step 1 — Add the language code to the `Language` type

```ts
// src/lib/i18n/types.ts
export type Language = 'en' | 'es' | 'fr' | 'zh' | 'ar' | 'pt'; // added 'pt'
```

### Step 2 — Add a translation object in `translations.ts`

```ts
// src/lib/i18n/translations.ts
import { TranslationKeys } from './types';

export const pt: TranslationKeys = {
  common: {
    loading: 'A carregar...',
    error: 'Erro',
    success: 'Sucesso',
    cancel: 'Cancelar',
    submit: 'Enviar',
    close: 'Fechar',
  },
  navigation: {
    home: 'Início',
    history: 'Histórico',
    settings: 'Definições',
  },
  offramp: {
    title: 'Converter para Moeda Fiduciária',
    enterAmount: 'Introduzir Valor',
    selectCurrency: 'Selecionar Moeda',
    selectBank: 'Selecionar Banco',
    accountNumber: 'Número de Conta',
    estimatedTime: 'Tempo Estimado',
    fees: 'Taxas',
    total: 'Total',
  },
  errors: {
    invalidAmount: 'Valor inválido',
    insufficientBalance: 'Saldo insuficiente',
    networkError: 'Erro de rede',
    transactionFailed: 'Transação falhou',
  },
};
```

### Step 3 — Register the translation in `i18n.ts`

```ts
// src/lib/i18n/i18n.ts
import { en, es, fr, zh, ar, pt } from './translations'; // add pt

const translations: Record<Language, TranslationKeys> = {
  en, es, fr, zh, ar, pt, // add pt
};
```

### Step 4 — Add to `LanguageSelector`

```tsx
// src/lib/i18n/LanguageSelector.tsx
const languages: Language[] = ['en', 'es', 'fr', 'zh', 'ar', 'pt']; // add 'pt'
```

### Step 5 — Mark RTL if needed

If the new language is right-to-left, update `isRTL()` in `i18n.ts`:

```ts
isRTL(): boolean {
  return ['ar', 'he', 'fa'].includes(this.currentLanguage);
}
```

### Step 6 — Run type-checks and tests

```bash
npx tsc --noEmit        # TypeScript must report zero errors
npm test                # All translation tests must pass
```

---

## RTL Language Support

### How RTL is detected

`I18n.isRTL()` returns `true` when the current language is in the RTL set. Currently only Arabic (`ar`) is in that set.

```ts
isRTL(): boolean {
  return this.currentLanguage === 'ar';
}
```

The `isRTL` boolean is exposed via `useI18n()` and the React context so every component can read it without calling `isRTL()` directly.

### Applying RTL in CSS/Tailwind

Use the `dir` attribute on a wrapper and let CSS logical properties handle the rest:

```html
<div dir="rtl">
  <!-- margin-inline-start / padding-inline-end automatically mirror -->
</div>
```

With Tailwind v4 (used in this project) you can use logical property utilities:

```tsx
// Instead of ml-4 / mr-4, use:
<div className="ms-4">…</div>   // margin-inline-start
<div className="me-4">…</div>   // margin-inline-end
```

### Flex direction mirroring

The `LanguageSelector` component shows how to handle row layouts:

```tsx
<div className={`flex gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
```

### Text alignment

```tsx
<p className={isRTL ? 'text-right' : 'text-left'}>…</p>
```

### Icons and arrows

Directional icons (chevrons, arrows) should mirror in RTL. Apply `scale-x-[-1]` with Tailwind:

```tsx
<ChevronRightIcon className={isRTL ? 'scale-x-[-1]' : ''} />
```

---

## Pluralization Rules

The current `TranslationKeys` interface does not have a built-in pluralization mechanism. For UI strings that need plural forms, use the following convention until a formal plural system is adopted.

### Simple quantity-based pattern

Pass the count to the `t()` helper via a wrapper function:

```ts
function tp(t: (key: string) => string, key: string, count: number): string {
  const plural = t(`${key}_plural`);
  const singular = t(key);
  return count === 1 ? singular : plural;
}
```

Add both keys to `TranslationKeys`:

```ts
// types.ts
transactions: {
  item: string;
  item_plural: string;
}

// translations.ts (en)
transactions: {
  item: '{{count}} transaction',
  item_plural: '{{count}} transactions',
}
```

Then interpolate the count in the component:

```tsx
const label = tp(t, 'transactions.item', count).replace('{{count}}', String(count));
```

### Language-specific plural rules

Arabic has six grammatical number forms (zero, one, two, few, many, other). When adding proper Arabic plural support, extend the keys or adopt a library such as `Intl.PluralRules`:

```ts
const rules = new Intl.PluralRules('ar');
const form = rules.select(count); // 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
const key = `transactions.item_${form}`;
return t(key).replace('{{count}}', String(count));
```

---

## Date and Number Formatting

Use the browser-native `Intl` API for locale-aware formatting. Derive the locale from the active `language` value.

### Language-to-locale map

```ts
const LOCALE_MAP: Record<Language, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  zh: 'zh-CN',
  ar: 'ar-SA',
};
```

### Date formatting

```ts
import { useI18n } from '@/lib/i18n';

function useFormattedDate(date: Date): string {
  const { language } = useI18n();
  const locale = LOCALE_MAP[language];
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
```

### Currency / amount formatting

Always include `currency` and `minimumFractionDigits` for financial values:

```ts
function formatAmount(amount: number, currency: string, language: Language): string {
  const locale = LOCALE_MAP[language];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
```

### Relative time

```ts
function formatRelativeTime(ms: number, language: Language): string {
  const locale = LOCALE_MAP[language];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.round(ms / 1000);
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return rtf.format(hours, 'hour');
}
```

---

## Language Detection Strategy

The current implementation requires the caller to pass `defaultLanguage` to `I18nProvider`. For automatic detection, adopt the following priority order:

### Recommended detection order

1. **User preference stored in `localStorage`** — persists across sessions.
2. **Browser `navigator.language`** — reflects the OS/browser setting.
3. **Fallback to `'en'`** — always available.

```ts
// src/lib/i18n/detect-language.ts
import type { Language } from './types';

const SUPPORTED: Language[] = ['en', 'es', 'fr', 'zh', 'ar'];

export function detectLanguage(): Language {
  // 1. Persisted preference
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('stellar-spend:language') as Language | null;
    if (stored && SUPPORTED.includes(stored)) return stored;
  }

  // 2. Browser language
  const browserLang = navigator.language.split('-')[0] as Language;
  if (SUPPORTED.includes(browserLang)) return browserLang;

  // 3. Fallback
  return 'en';
}
```

Use it as the `defaultLanguage` prop:

```tsx
import { detectLanguage } from '@/lib/i18n/detect-language';

<I18nProvider defaultLanguage={detectLanguage()}>
```

### Persisting the user's choice

Call `localStorage.setItem` whenever `setLanguage` is invoked, or extend `I18nProvider` to do it automatically:

```tsx
const setLanguage = useCallback((lang: Language) => {
  i18nInstance.setLanguage(lang);
  setLanguageState(lang);
  localStorage.setItem('stellar-spend:language', lang);
}, [i18nInstance]);
```

---

## Testing Translations

### Unit testing the I18n class

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { I18n } from '@/lib/i18n/i18n';

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(() => {
    i18n = new I18n('en');
  });

  it('returns the correct translation for a known key', () => {
    expect(i18n.t('common.submit')).toBe('Submit');
  });

  it('returns the raw key for an unknown key', () => {
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
  });

  it('switches language correctly', () => {
    i18n.setLanguage('es');
    expect(i18n.t('common.submit')).toBe('Enviar');
  });

  it('reports RTL correctly for Arabic', () => {
    i18n.setLanguage('ar');
    expect(i18n.isRTL()).toBe(true);
  });

  it('reports LTR correctly for non-RTL languages', () => {
    (['en', 'es', 'fr', 'zh'] as const).forEach((lang) => {
      i18n.setLanguage(lang);
      expect(i18n.isRTL()).toBe(false);
    });
  });

  it('lists all supported languages', () => {
    expect(i18n.getSupportedLanguages()).toEqual(['en', 'es', 'fr', 'zh', 'ar']);
  });
});
```

### Testing that all translation keys are present

```ts
import { describe, it, expect } from 'vitest';
import { en, es, fr, zh, ar } from '@/lib/i18n/translations';
import type { TranslationKeys } from '@/lib/i18n/types';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null
      ? collectKeys(v as Record<string, unknown>, full)
      : [full];
  });
}

const BASE_KEYS = collectKeys(en as unknown as Record<string, unknown>);

describe('translation completeness', () => {
  const languages: [string, TranslationKeys][] = [
    ['es', es], ['fr', fr], ['zh', zh], ['ar', ar],
  ];

  it.each(languages)('%s has all keys present in en', (_name, translations) => {
    const keys = collectKeys(translations as unknown as Record<string, unknown>);
    expect(keys).toEqual(expect.arrayContaining(BASE_KEYS));
  });
});
```

### Testing the LanguageSelector component

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { LanguageSelector } from '@/lib/i18n/LanguageSelector';

function renderWithProvider(defaultLanguage = 'en' as const) {
  return render(
    <I18nProvider defaultLanguage={defaultLanguage}>
      <LanguageSelector />
    </I18nProvider>
  );
}

describe('LanguageSelector', () => {
  it('renders buttons for all supported languages', () => {
    renderWithProvider();
    ['EN', 'ES', 'FR', 'ZH', 'AR'].forEach((lang) => {
      expect(screen.getByRole('button', { name: new RegExp(lang, 'i') })).toBeInTheDocument();
    });
  });

  it('highlights the active language', () => {
    renderWithProvider('es');
    const esButton = screen.getByRole('button', { name: /es/i });
    expect(esButton).toHaveClass('bg-blue-600');
  });

  it('changes language on click', async () => {
    renderWithProvider('en');
    await userEvent.click(screen.getByRole('button', { name: /fr/i }));
    expect(screen.getByRole('button', { name: /fr/i })).toHaveClass('bg-blue-600');
  });
});
```

### Running the tests

```bash
# Run all unit tests
npm test

# Run only i18n-related tests
npx vitest run --reporter=verbose src/lib/i18n
```
