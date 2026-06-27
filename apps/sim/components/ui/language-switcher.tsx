'use client'

import { useTransition } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import { LOCALE_COOKIE, locales, type AppLocale } from '@/lib/i18n/config'
import { ChipDropdown } from '@/components/emcn'

const LANGUAGE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  ru: 'Русский',
  de: 'Deutsch',
}

const LANGUAGE_EMOJI: Record<AppLocale, string> = {
  en: '🇺🇸',
  ru: '🇷🇺',
  de: '🇩🇪',
}

export function LanguageSwitcher() {
  const locale = useLocale() as AppLocale
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const options = locales.map((l) => ({
    value: l,
    label: `${LANGUAGE_EMOJI[l]} ${LANGUAGE_LABELS[l]}`,
  }))

  return (
    <ChipDropdown
      options={options}
      value={locale}
      placeholder={LANGUAGE_EMOJI[locale]}
      disabled={isPending}
      onChange={(value) => {
        document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
        startTransition(() => {
          router.refresh()
        })
      }}
    />
  )
}
