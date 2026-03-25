'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DiscordIcon } from '@/components/icons'
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
  { label: 'Changelog', href: 'https://sim.ai/changelog', external: true },
] as const

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className='sticky top-0 z-50 bg-background/80 pt-2 backdrop-blur-md backdrop-saturate-150'>
      <div className='hidden w-full flex-col lg:flex'>
        {/* Top row: logo, search, controls */}
        <div className='relative flex h-[52px] w-full items-center justify-between px-8'>
          <Link href='/' className='flex min-w-[100px] items-center'>
            <SimLogoFull className='h-6 w-auto' />
          </Link>

          <div className='-translate-x-1/2 absolute left-1/2 flex items-center justify-center'>
            <SearchTrigger />
          </div>

          <div className='flex items-center gap-2'>
            <Link
              href='https://discord.gg/Hr4UWYEcTT'
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex h-[30px] items-center gap-[6px] rounded-[5px] border border-neutral-200 bg-white px-[10px] font-medium text-[12px] text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-700'
              aria-label='Get help on Discord'
            >
              <DiscordIcon className='h-[13px] w-[13px]' />
              Discord
            </Link>
            <Link
              href='https://sim.ai'
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex h-[30px] items-center rounded-[5px] bg-[#33C482] px-[10px] font-medium text-[#1b1b1b] text-[12px] transition-colors hover:bg-[#2DAC72]'
              aria-label='Go to Sim AI'
            >
              Mothership
            </Link>
            <LanguageDropdown />
            <ThemeToggle />
          </div>
        </div>

        {/* Bottom row: navigation tabs */}
        <div className='flex h-[40px] items-stretch gap-7 border-neutral-200/40 border-b px-8 dark:border-neutral-700/30'>
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
