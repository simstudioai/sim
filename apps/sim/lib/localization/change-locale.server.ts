'use server'

import type { Locale } from 'next-intl'
import { cookies } from 'next/headers'

/**
 * change user locale for SIM app
 */
export async function changeLocale(locale: Locale) {
  const store = await cookies()

  store.set('locale', locale)
}
