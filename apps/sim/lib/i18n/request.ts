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
] as const

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value
  const locale: AppLocale = hasLocale(locales, fromCookie) ? fromCookie : defaultLocale

  const messages: Record<string, Record<string, string>> = {}
  for (const module of TRANSLATION_MODULES) {
    const mod = (await import(`../../messages/${locale}/${module}.json`)).default
    messages[module] = mod
  }

  return { locale, messages }
})
