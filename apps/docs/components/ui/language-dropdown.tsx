'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

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
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1)
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

  // Reset hovered index when popover closes
  useEffect(() => {
    if (!isOpen) {
      setHoveredIndex(-1)
    }
  }, [isOpen])

  const languageEntries = Object.entries(languages)

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
        className='flex cursor-pointer items-center gap-1.5 rounded-[6px] px-3 py-2 font-normal text-[0.9375rem] text-foreground/60 leading-[1.4] transition-colors hover:bg-foreground/8 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <span>{languages[currentLang as keyof typeof languages]?.name}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <>
          <div className='fixed inset-0 z-[1000]' aria-hidden onClick={() => setIsOpen(false)} />
          <div
            id='language-menu'
            role='listbox'
            className='absolute top-full right-0 z-[1001] mt-2 max-h-[400px] min-w-[160px] overflow-auto rounded-[6px] bg-white px-[6px] py-[6px] shadow-lg dark:bg-neutral-900'
          >
            {languageEntries.map(([code, lang], index) => {
              const isSelected = currentLang === code
              const isHovered = hoveredIndex === index

              return (
                <button
                  key={code}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleLanguageChange(code)
                  }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(-1)}
                  role='option'
                  aria-selected={isSelected}
                  className={cn(
                    'flex h-[26px] w-full min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] px-[6px] text-[13px] transition-colors',
                    'text-neutral-700 dark:text-neutral-200',
                    isHovered && 'bg-neutral-100 dark:bg-neutral-800',
                    'focus:outline-none'
                  )}
                >
                  <span className='text-[13px]'>{lang.flag}</span>
                  <span className='flex-1 text-left leading-none'>{lang.name}</span>
                  {isSelected && <Check className='ml-auto h-3.5 w-3.5' />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
