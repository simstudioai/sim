'use client'

import { type Locale, useLocale } from 'next-intl'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { changeLocale } from '@/lib/localization/change-locale.server'
import { useMutation } from '@tanstack/react-query'

export default function LocaleSelector() {
  const t = useTranslations()
  const locale = useLocale()
  const { refresh } = useRouter()

  const selectedLocaleLabel = useMemo(() => {
    switch (locale) {
      case 'pt':
        return t('localization.pt')
      case 'en':
        return t('localization.en')
      case 'es':
        return t('localization.es')
    }
  }, [locale])

  const { mutate: mutateChangeLocale, isPending: isChangingLocale } = useMutation({
    mutationFn: changeLocale,
    onSuccess: () => {
      refresh()
    },
  })

  const handleLocaleChange = async (locale: Locale) => {
    mutateChangeLocale(locale)
  }

  return (
    <Select value={locale} onValueChange={handleLocaleChange}>
      <SelectTrigger disabled={isChangingLocale} className='w-[180px]'>
        <SelectValue placeholder={selectedLocaleLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value='en'>{t('localization.en')}</SelectItem>
          <SelectItem value='pt'>{t('localization.pt')}</SelectItem>
          <SelectItem value='es'>{t('localization.es')}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
