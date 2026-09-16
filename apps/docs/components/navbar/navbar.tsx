'use client'

import { ChipLink } from '@sim/emcn'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SearchTrigger } from '@/components/ui/search-trigger'
import { SimWordmark } from '@/components/ui/sim-logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/utils'

/**
 * Sections that own a tab, in reading order: the main docs, then the two
 * reference surfaces, then Academy. `Documentation` matches by exclusion, so
 * every section listed here is one it must not claim.
 */
const SECTION_TABS = ['api-reference', 'academy', 'cli'] as const

/**
 * Whether a pathname is inside a section, matched by whole path segment.
 *
 * A substring test is wrong: `/integrations/clickup` and
 * `/integrations/clickhouse` both contain `/cli`, which lit the CLI tab and
 * unlit Documentation on two existing integration pages.
 */
function isInSection(pathname: string, section: string): boolean {
  return (
    pathname === `/${section}` ||
    pathname.endsWith(`/${section}`) ||
    pathname.includes(`/${section}/`)
  )
}

const NAV_TABS = [
  {
    label: 'Documentation',
    href: '/introduction',
    match: (p: string) => !SECTION_TABS.some((section) => isInSection(p, section)),
    external: false,
  },
  {
    label: 'API Reference',
    href: '/api-reference/getting-started',
    match: (p: string) => isInSection(p, 'api-reference'),
    external: false,
  },
  {
    label: 'CLI',
    href: '/cli',
    match: (p: string) => isInSection(p, 'cli'),
    external: false,
  },
  {
    label: 'Academy',
    href: '/academy',
    match: (p: string) => isInSection(p, 'academy'),
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
          <Link href='/' aria-label='Sim documentation home' className='flex items-center'>
            <SimWordmark className='h-[18px]' />
          </Link>

          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          <div className='flex items-center gap-2'>
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
                aria-current={isActive ? 'page' : undefined}
                {...(tab.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={cn(
                  '-mb-px relative flex items-center border-b text-sm tracking-[-0.01em] transition-colors',
                  isActive
                    ? 'border-[var(--text-muted)] font-medium text-[var(--text-primary)]'
                    : 'border-transparent font-normal text-[var(--text-secondary)] hover:border-[var(--border-1)] hover:text-[var(--text-primary)]'
                )}
              >
                {/* Invisible bold text reserves width to prevent layout shift */}
                <span className='invisible font-medium'>{tab.label}</span>
                <span className='absolute'>{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
