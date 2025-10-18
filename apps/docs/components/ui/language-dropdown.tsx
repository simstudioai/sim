'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
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
        className='flex items-center gap-1.5 rounded-xl px-3 py-2 font-normal text-[0.9375rem] text-foreground/60 leading-[1.4] transition-colors hover:bg-foreground/8 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <span>{languages[currentLang as keyof typeof languages]?.name}</span>
        <ChevronRight className='h-3.5 w-3.5' />
      </button>

      {isOpen && (
        <>
          <div className='fixed inset-0 z-[1000]' aria-hidden onClick={() => setIsOpen(false)} />
          <div
            id='language-menu'
            role='listbox'
            className='absolute top-full right-0 z-[1001] mt-1 max-h-[75vh] w-56 overflow-auto rounded-xl border border-border/50 bg-white shadow-2xl md:w-44 md:bg-background/95 md:backdrop-blur-md dark:bg-neutral-950 md:dark:bg-background/95'
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
