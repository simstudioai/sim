import { cookies } from 'next/headers'
import type { Locale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

export const locales = ['en', 'pt', 'es'] as const
const defaultLocale = 'en'

export default getRequestConfig(async () => {
  const store = await cookies()
  const locale = (store.get('locale')?.value as Locale) || defaultLocale

  return {
    locale,
    messages: (await import(`../translations/${locale}.json`)).default,
  }
})
