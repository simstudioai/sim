'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  }, [params])

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

    router.push(newPath)
  }

  const languageEntries = Object.entries(languages)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className='flex cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] text-foreground/50 transition-colors duration-200 hover:bg-neutral-100 hover:text-foreground/70 focus:outline-none dark:hover:bg-neutral-800 dark:hover:text-foreground/70'>
          <span>{languages[currentLang as keyof typeof languages]?.name}</span>
          <svg width='8' height='5' viewBox='0 0 10 6' fill='none' className='flex-shrink-0'>
            <path
              d='M1 1L5 5L9 1'
              stroke='currentColor'
              strokeWidth='1.33'
              strokeLinecap='square'
              strokeLinejoin='miter'
            />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={6} className='min-w-[160px]'>
        {languageEntries.map(([code, lang]) => {
          const isSelected = currentLang === code

          return (
            <DropdownMenuItem
              key={code}
              onClick={() => handleLanguageChange(code)}
              className={cn(
                'flex cursor-pointer items-center gap-2 text-[13px]',
                isSelected && 'font-medium'
              )}
            >
              <span className='text-[13px]'>{lang.flag}</span>
              <span className='flex-1'>{lang.name}</span>
              {isSelected && <Check className='ml-auto h-3.5 w-3.5' />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
