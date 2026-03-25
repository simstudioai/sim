'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'
import { SimLogoFull } from '@/components/ui/sim-logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/utils'

const NAV_TABS = [
  {
    label: 'Documentation',
    href: '/introduction',
    match: (p: string) => !p.includes('/api-reference'),
    external: false,
  },
  {
    label: 'API Reference',
    href: '/api-reference/getting-started',
    match: (p: string) => p.includes('/api-reference'),
    external: false,
  },
  { label: 'Mothership', href: 'https://sim.ai', external: true },
  { label: 'Changelog', href: 'https://sim.ai/changelog', external: true },

] as const

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className='sticky top-0 z-50 bg-background/80 backdrop-blur-md backdrop-saturate-150'>
      <div className='hidden w-full flex-col lg:flex'>
        {/* Top row: logo, search, controls */}
        <div
          className='relative flex h-[52px] w-full items-center justify-between'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + 32px)',
            paddingRight: 'calc(var(--toc-offset) + 60px)',
          }}
        >
          <Link href='/' className='flex min-w-[100px] items-center'>
            <SimLogoFull className='h-6 w-auto' />
          </Link>

          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          <div className='flex items-center gap-1.5'>
            <LanguageDropdown />
            <ThemeToggle />
          </div>
        </div>

        {/* Bottom row: navigation tabs */}
        <div
          className='flex h-[40px] items-stretch gap-7 border-neutral-200/40 border-b dark:border-neutral-700/30'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + 32px)',
          }}
        >
          {NAV_TABS.map((tab) => {
            const isActive = !tab.external && tab.match(pathname)
            return (
              <Link
                key={tab.label}
                href={tab.href}
                {...(tab.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={cn(
                  '-mb-px relative flex items-center border-b-2 text-[13.5px] tracking-[-0.01em] transition-colors',
                  isActive
                    ? 'border-neutral-800 font-[520] text-neutral-900 dark:border-neutral-300 dark:text-neutral-100'
                    : 'border-transparent font-[420] text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300'
                )}
              >
                {/* Invisible bold text reserves width to prevent layout shift */}
                <span className='invisible font-[520]'>{tab.label}</span>
                <span className='absolute'>{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
