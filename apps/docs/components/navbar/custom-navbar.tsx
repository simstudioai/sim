'use client'

import Image from 'next/image'
import Link from 'next/link'
import { CustomThemeToggle } from '@/components/ui/custom-theme-toggle'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'

export function CustomNavbar() {
  return (
    <nav
      className='sticky top-0 z-50 flex h-16 items-center border-border/50 border-b bg-background/90 backdrop-blur-xl'
      style={{
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
      {/* Left: Logo - positioned to align with sidebar */}
      <Link href='/' className='flex items-center' style={{ marginLeft: 'calc(22rem + 2rem)' }}>
        <Image src='/static/logo.png' alt='Sim' width={72} height={28} className='h-7 w-auto' />
      </Link>

      {/* Center: Search */}
      <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2'>
        <SearchTrigger />
      </div>

      {/* Right: Links, Language, Theme - positioned above TOC area */}
      <div
        className='absolute right-0 flex items-center gap-4'
        style={{ marginRight: 'calc(27.5rem + 2rem)' }}
      >
        <Link
          href='https://sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className='rounded-xl px-3 py-2 font-normal text-[0.9375rem] text-foreground/60 leading-[1.4] transition-colors hover:bg-foreground/8 hover:text-foreground'
          style={{
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          }}
        >
          Platform
        </Link>
        <LanguageDropdown />
        <CustomThemeToggle />
      </div>
    </nav>
  )
}
