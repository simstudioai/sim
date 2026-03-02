'use client'

import { type Locale, useLocale } from 'next-intl'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { changeLocale } from '@/lib/localization/change-locale.server'
import { useMutation } from '@tanstack/react-query'
import { Combobox } from './emcn'

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
    <div className='w-[160px]'>
      <Combobox
        size='sm'
        align='end'
        dropdownWidth={160}
        value={String(locale)}
        onChange={(value) => {
          handleLocaleChange(value as Locale)
        }}
        placeholder={selectedLocaleLabel}
        options={[
          { label: t('localization.en'), value: 'en' },
          { label: t('localization.pt'), value: 'pt' },
          { label: t('localization.es'), value: 'es' },
        ]}
      />
    </div>
  )
}
