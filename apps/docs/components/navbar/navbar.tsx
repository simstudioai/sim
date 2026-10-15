'use client'

import { ChipLink } from '@sim/emcn'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SearchTrigger } from '@/components/ui/search-trigger'
import { SimWordmark } from '@/components/ui/sim-logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { DOCS_SECTIONS, getDocsSection } from '@/lib/navigation'
import { SIM_SITE_URL } from '@/lib/urls'
import { cn } from '@/lib/utils'

export function Navbar() {
  const section = getDocsSection(usePathname())

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
            <ChipLink href={SIM_SITE_URL} variant='primary'>
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
          {DOCS_SECTIONS.map((tab) => {
            const isActive = section === tab.slug
            return (
              <Link
                key={tab.label}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px relative flex items-center border-b text-sm tracking-[-0.01em] transition-colors',
                  isActive
                    ? 'border-[var(--text-muted)] font-medium text-[var(--text-primary)]'
                    : 'border-transparent font-normal text-[var(--text-secondary)] hover:border-[var(--border)] hover:text-[var(--text-primary)]'
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
