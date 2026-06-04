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
            paddingLeft: 'calc(var(--sidebar-offset) + var(--nav-inset))',
            paddingRight: 'calc(var(--toc-offset) + var(--nav-inset))',
          }}
        >
          <Link href='/' className='flex min-w-[100px] items-center'>
            <SimLogoFull className='h-[20px] w-auto' />
          </Link>

          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          <div className='flex items-center gap-1'>
            <LanguageDropdown />
            <ThemeToggle />
            <Link
              href='https://sim.ai'
              className='ml-1 flex items-center rounded-[8px] bg-[#33c482] px-2.5 py-1.5 text-[13px] text-white transition-colors duration-200 hover:bg-[#2DAC72]'
            >
              Get started
            </Link>
          </div>
        </div>

        {/* Bottom row: navigation tabs — border on row, tabs overlap it */}
        <div
          className='flex h-[40px] items-stretch gap-6 border-border/20 border-b'
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
                    ? 'border-neutral-400 font-[480] text-neutral-800 dark:border-neutral-500 dark:text-neutral-200'
                    : 'border-transparent font-[430] text-neutral-500 hover:border-neutral-300 hover:text-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-300'
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
