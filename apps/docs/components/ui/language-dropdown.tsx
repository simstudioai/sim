'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const params = useParams()
  const router = useRouter()

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

    router.push(newPath)
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  return (
    <div className='relative'>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        aria-controls='language-menu'
        className='flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/40 px-2.5 py-1.5 text-sm shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <span className='text-sm'>{languages[currentLang as keyof typeof languages]?.flag}</span>
        <span className='font-medium text-foreground'>
          {languages[currentLang as keyof typeof languages]?.name}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className='fixed inset-0 z-[1000]' aria-hidden onClick={() => setIsOpen(false)} />
          <div
            id='language-menu'
            role='listbox'
            className='absolute top-full left-0 z-[1001] mt-1 max-h-[75vh] w-56 overflow-auto rounded-xl border border-border/50 bg-white shadow-2xl md:w-44 md:bg-background/95 md:backdrop-blur-md dark:bg-neutral-950 md:dark:bg-background/95'
          >
            {Object.entries(languages).map(([code, lang]) => (
              <button
                key={code}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleLanguageChange(code)
                }}
                role='option'
                aria-selected={currentLang === code}
                className={`flex w-full items-center gap-3 px-3 py-3 text-base transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:gap-2 md:px-2.5 md:py-2 md:text-sm ${
                  currentLang === code ? 'bg-muted/60 font-medium text-primary' : 'text-foreground'
                }`}
              >
                <span className='text-base md:text-sm'>{lang.flag}</span>
                <span className='leading-none'>{lang.name}</span>
                {currentLang === code && (
                  <Check className='ml-auto h-4 w-4 text-primary md:h-3.5 md:w-3.5' />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
