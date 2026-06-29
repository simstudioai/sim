'use client'

import { ChipDropdown } from '@sim/emcn'
import { useParams, usePathname, useRouter } from 'next/navigation'

const languages = {
  en: { name: 'English', flag: '🇺🇸' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  ja: { name: '日本語', flag: '🇯🇵' },
  zh: { name: '简体中文', flag: '🇨🇳' },
}

export function LanguageDropdown() {
  const pathname = usePathname()
  const params = useParams()
  const { push } = useRouter()

  const languageOptions = Object.entries(languages).map(([code, lang]) => ({
    value: code,
    label: lang.name,
    iconElement: <span className='text-[13px]'>{lang.flag}</span>,
  }))

  const langFromParams = params?.lang as string
  const currentLang =
    langFromParams && Object.keys(languages).includes(langFromParams) ? langFromParams : 'en'

  const handleLanguageChange = (locale: string) => {
    if (locale === currentLang) return

    const segments = pathname.split('/').filter(Boolean)

    if (segments[0] && Object.keys(languages).includes(segments[0])) {
      segments.shift()
    }

    let newPath = ''
    if (locale === 'en') {
      newPath = segments.length > 0 ? `/${segments.join('/')}` : '/introduction'
    } else {
      newPath = `/${locale}${segments.length > 0 ? `/${segments.join('/')}` : '/introduction'}`
    }

    push(newPath)
  }

  return (
    <ChipDropdown
      value={currentLang}
      onChange={handleLanguageChange}
      options={languageOptions}
      align='end'
      matchTriggerWidth={false}
      contentClassName='min-w-[160px]'
    />
  )
}
