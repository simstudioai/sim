'use client'

import Image from 'next/image'
import Link from 'next/link'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export function Navbar() {
  return (
    <nav
      className='sticky top-0 z-50 border-border/50 border-b'
      style={{
        backdropFilter: 'blur(25px) saturate(180%)',
        WebkitBackdropFilter: 'blur(25px) saturate(180%)',
      }}
    >
      {/* Desktop: Single row layout */}
      <div className='hidden h-16 w-full items-center lg:flex'>
        <div
          className='relative flex w-full items-center justify-between'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + 20px)',
            paddingRight: 'calc(var(--toc-offset) + 60px)',
          }}
        >
          {/* Left cluster: logo */}
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

          {/* Center cluster: search - absolutely positioned to center */}
          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          {/* Right cluster aligns with TOC edge */}
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
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  )
}
