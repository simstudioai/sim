'use client'

import { Menu } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { CustomThemeToggle } from '@/components/ui/custom-theme-toggle'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'

export function CustomNavbar() {
  return (
    <nav
      className='sticky top-0 z-50 border-border/50 border-b bg-background/95'
      style={{
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Mobile: Stacked Layout */}
      <div
        className='flex w-full flex-col bg-background lg:hidden'
        style={{ paddingLeft: 'var(--layout-gutter)', paddingRight: 'var(--layout-gutter)' }}
      >
        {/* Top row: Menu button, Logo and controls */}
        <div className='flex h-14 items-center justify-between border-border/30 border-b'>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              className='flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent lg:hidden'
              aria-label='Toggle Sidebar'
              onClick={() => {
                const event = new CustomEvent('fd-toggle-sidebar')
                window.dispatchEvent(event)
              }}
            >
              <Menu className='h-5 w-5' />
            </button>
            <Link href='/' className='z-10 flex items-center'>
              <Image
                src='/static/logo.png'
                alt='Sim'
                width={72}
                height={28}
                className='h-7 w-auto'
                priority
              />
            </Link>
          </div>
          <div className='z-10 flex items-center gap-2'>
            <LanguageDropdown />
            <CustomThemeToggle />
          </div>
        </div>
        {/* Bottom row: Search bar */}
        <div className='flex w-full items-center justify-center bg-background/95 pt-3 pb-4'>
          <SearchTrigger />
        </div>
      </div>

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
