import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { defaultLocale, LOCALE_COOKIE, locales, type AppLocale } from '@/lib/i18n/config'

/** Модули перевода — каждый в отдельном файле. Добавляй новые модули сюда. */
const TRANSLATION_MODULES = [
  'common',
  'nav',
  'billing',
  'workspace',
  'workflow',
  'errors',
  'time',
  'editor',
  'chat',
  'notifications',
  'table',
  'knowledge',
  'auth',
  'settings',
  'integrations',
  'empty',
  'landing',
  'auto',
] as const

/**
 * The `blocks` namespace is split into one small JSON per block definition
 * (messages/{locale}/blocks/*.json) and merged here. The canonical file list
 * lives in en/blocks/_index.json; per-locale files that don't exist yet are
 * skipped so the UI falls back to the English source via `useBlockText`.
 * Merged catalogs are memoized per locale.
 */
const blocksCache = new Map<string, Record<string, string>>()

async function loadBlocks(locale: string): Promise<Record<string, string>> {
  const cached = blocksCache.get(locale)
  if (cached) return cached

  const index = (await import('../../messages/en/blocks/_index.json')).default as string[]
  const merged: Record<string, string> = {}
  for (const name of index) {
    try {
      const mod = (await import(`../../messages/${locale}/blocks/${name}.json`)).default
      Object.assign(merged, mod)
    } catch {
      // per-locale file not present yet — English fallback handles it
    }
  }
  blocksCache.set(locale, merged)
  return merged
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value
  const locale: AppLocale = hasLocale(locales, fromCookie) ? fromCookie : defaultLocale

  const messages: Record<string, Record<string, string>> = {}
  for (const module of TRANSLATION_MODULES) {
    const mod = (await import(`../../messages/${locale}/${module}.json`)).default
    messages[module] = mod
  }
  messages.blocks = await loadBlocks(locale)

  return { locale, messages }
})
