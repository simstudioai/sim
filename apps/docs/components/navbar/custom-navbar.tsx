'use client'

import Image from 'next/image'
import Link from 'next/link'
import { CustomThemeToggle } from '@/components/ui/custom-theme-toggle'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'

export function CustomNavbar() {
  return (
    <nav
      className='sticky top-0 z-50 border-border/50 border-b'
      style={{
        backgroundColor: 'hsla(0, 0%, 7.04%, 0.92)',
        backdropFilter: 'blur(25px) saturate(180%) brightness(0.6)',
        WebkitBackdropFilter: 'blur(25px) saturate(180%) brightness(0.6)',
      }}
    >
      {/* Desktop: Single row layout */}
      <div className='hidden h-16 w-full items-center lg:flex'>
        <div
          className='grid w-full grid-cols-[auto_1fr_auto] items-center'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + 20px)',
            paddingRight: 'calc(var(--toc-offset) + 20px)',
          }}
        >
          {/* Left cluster: translate by sidebar delta to align with sidebar edge */}
          <div className='flex items-center'>
            <Link href='/' className='flex min-w-[100px] items-center'>
              <Image
                src='/static/logo.png'
                alt='Sim'
                width={72}
                height={28}
                className='h-7 w-auto'
              />
            </Link>
          </div>

          {/* Center cluster: search */}
          <div className='flex flex-1 items-center justify-center'>
            <SearchTrigger />
          </div>

          {/* Right cluster aligns with TOC edge using the same right gutter */}
          <div className='flex items-center gap-4'>
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
        </div>
      </div>
    </nav>
  )
}
