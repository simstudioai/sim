import type { Locale } from 'next-intl'

export const locales = ['en', 'ru', 'de'] as const satisfies Locale[]
export type AppLocale = (typeof locales)[number]
export const defaultLocale: AppLocale = 'en'

/** Cookie used by next-intl and the language switcher (no URL prefix routing). */
export const LOCALE_COOKIE = 'NEXT_LOCALE' as const

/**
 * Next.js 16 allows only `proxy.ts` — do NOT add `middleware.ts` for i18n.
 * Locale is read from {@link LOCALE_COOKIE} in `request.ts` and set by `LanguageSwitcher`.
 */
