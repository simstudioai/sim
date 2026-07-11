'use client'

import { ChipLink } from '@sim/emcn'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { SearchTrigger } from '@/components/ui/search-trigger'
import { SimLogoIcon } from '@/components/ui/sim-logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/utils'

const NAV_TABS = [
  {
    label: 'Documentation',
    href: '/introduction',
    match: (p: string) => !p.includes('/api-reference') && !p.includes('/academy'),
    external: false,
  },
  {
    label: 'Academy',
    href: '/academy',
    match: (p: string) => p.includes('/academy'),
    external: false,
  },
  {
    label: 'API Reference',
    href: '/api-reference/getting-started',
    match: (p: string) => p.includes('/api-reference'),
    external: false,
  },
] as const

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className='sticky top-0 z-50 bg-[var(--bg)]/80 backdrop-blur-md backdrop-saturate-150'>
      <div className='hidden w-full flex-col lg:flex'>
        {/* Top row: logo, search, controls */}
        <div
          className='relative flex h-[52px] w-full items-center justify-between'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + var(--nav-inset))',
            paddingRight: 'calc(var(--toc-offset) + var(--nav-inset))',
          }}
        >
          <Link href='/' className='flex items-center'>
            <SimLogoIcon className='size-[22px]' />
          </Link>

          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          <div className='flex items-center gap-2'>
            <LanguageDropdown />
            <ThemeToggle />
            <ChipLink href='https://sim.ai' variant='primary'>
              Get started
            </ChipLink>
          </div>
        </div>

        {/* Bottom row: navigation tabs — border on row, tabs overlap it */}
        <div
          className='flex h-[40px] items-stretch gap-6 border-[var(--border)]/20 border-b'
          style={{
            paddingLeft: 'calc(var(--sidebar-offset) + var(--nav-inset))',
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
                  '-mb-px relative flex items-center border-b text-[14px] tracking-[-0.01em] transition-colors',
                  isActive
                    ? 'border-[var(--text-muted)] font-[480] text-[var(--text-primary)]'
                    : 'border-transparent font-[430] text-[var(--text-muted)] hover:border-[var(--border-1)] hover:text-[var(--text-secondary)]'
                )}
              >
                {/* Invisible bold text reserves width to prevent layout shift */}
                <span className='invisible font-[480]'>{tab.label}</span>
                <span className='absolute'>{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
