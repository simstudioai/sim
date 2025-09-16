'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams, usePathname } from 'next/navigation'

const languages = {
  en: { name: 'English', flag: '🇺🇸' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  zh: { name: '简体中文', flag: '🇨🇳' },
}

export function LanguageDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const params = useParams()

  const [currentLang, setCurrentLang] = useState(() => {
    const langFromParams = params?.lang as string
    return langFromParams && Object.keys(languages).includes(langFromParams) ? langFromParams : 'en'
  })

  useEffect(() => {
    const langFromParams = params?.lang as string

    if (langFromParams && Object.keys(languages).includes(langFromParams)) {
      if (langFromParams !== currentLang) {
        setCurrentLang(langFromParams)
      }
    } else {
      if (currentLang !== 'en') {
        setCurrentLang('en')
      }
    }
  }, [params, currentLang])

  const handleLanguageChange = (locale: string) => {
    if (locale === currentLang) {
      setIsOpen(false)
      return
    }

    setIsOpen(false)

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

    window.location.href = newPath
  }

  return (
    <div className='relative'>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className='flex items-center gap-2 rounded-xl border border-border/20 bg-muted/50 px-3 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-muted'
      >
        <span className='text-base'>{languages[currentLang as keyof typeof languages]?.flag}</span>
        <span className='font-medium text-foreground'>
          {languages[currentLang as keyof typeof languages]?.name}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className='fixed inset-0 z-10' onClick={() => setIsOpen(false)} />
          <div className='absolute top-full left-0 z-20 mt-1 w-48 rounded-lg border border-border/50 bg-background/95 shadow-xl backdrop-blur-md'>
            {Object.entries(languages).map(([code, lang]) => (
              <button
                key={code}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleLanguageChange(code)
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/80 ${
                  currentLang === code ? 'bg-muted/60 font-medium text-primary' : 'text-foreground'
                }`}
              >
                <span className='text-base'>{lang.flag}</span>
                <span>{lang.name}</span>
                {currentLang === code && <Check className='ml-auto h-4 w-4 text-primary' />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
