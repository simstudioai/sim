'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/components/docs/classnames'
import { SidebarNavigation } from '@/components/docs/navigation'
import { DocsNavigationContext } from '@/components/docs/navigation-context'
import { DocsNavigationDrawer } from '@/components/docs/navigation-drawer'
import { DocsSearchProvider, DocsSearchTrigger } from '@/components/docs/search'
import { ThemeSwitch } from '@/components/docs/theme'
import { SimWordmark } from '@/components/ui/sim-logo'
import type { DocsSection, NavNode } from '@/lib/content/types'
import { DOCS_SECTIONS, getDocsSection } from '@/lib/navigation'
import { SIM_SITE_URL } from '@/lib/urls'

interface DocsShellProps {
  children: ReactNode
  navigationBySection: Record<DocsSection, NavNode[]>
}
interface SectionTabsProps {
  pathname: string
  mobile?: boolean
}

function SectionTabs({ pathname, mobile = false }: SectionTabsProps) {
  const section = getDocsSection(pathname)
  return (
    <nav
      aria-label='Documentation sections'
      className={cn(
        'items-center gap-7 text-[var(--docs-text)] text-docs-header',
        mobile ? 'flex h-12 overflow-x-auto px-5 lg:hidden' : 'hidden lg:flex'
      )}
    >
      {DOCS_SECTIONS.map((tab) => (
        <Link
          key={tab.slug}
          href={tab.href}
          draggable={false}
          aria-current={
            pathname === tab.href ? 'page' : tab.slug === section ? 'location' : undefined
          }
          className={cn(
            'flex h-full shrink-0 items-center rounded-sm font-normal transition-colors hover:text-[var(--docs-heading)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4',
            tab.slug === section && 'text-[var(--docs-heading)]'
          )}
        >
          {mobile ? tab.compactLabel : tab.label}
        </Link>
      ))}
    </nav>
  )
}

/** Shared responsive reading frame; article children remain server-rendered. */
export function DocsShell({ children, navigationBySection }: DocsShellProps) {
  const pathname = usePathname()
  const section = getDocsSection(pathname)
  const navigation = navigationBySection[section === 'api-reference' ? 'api' : section]
  return (
    <DocsNavigationContext value={{ navigation, pathname }}>
      <DocsSearchProvider navigation={navigation} section={section}>
        <DocsNavigationDrawer>
          <header className='sticky top-0 z-40 select-none bg-[var(--docs-glass)] backdrop-blur-[var(--docs-chrome-blur)]'>
            <div className='mx-auto flex h-14 max-w-[1280px] items-center gap-10 px-5 lg:px-4'>
              <Link
                href='/introduction'
                draggable={false}
                aria-label='Sim documentation home'
                className='inline-flex h-8 shrink-0 items-center focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4'
              >
                <SimWordmark />
              </Link>
              <SectionTabs pathname={pathname} />
              <div className='ml-auto flex items-center gap-2 font-[450] text-docs-header'>
                <a
                  href={`${SIM_SITE_URL}/contact`}
                  draggable={false}
                  className='hidden rounded-full bg-[var(--docs-secondary-fill)] px-4 py-1.5 text-[var(--docs-heading)] transition-colors hover:bg-[var(--docs-secondary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 active:bg-[var(--docs-secondary-pressed)] sm:block'
                >
                  Contact sales
                </a>
                <a
                  href={`${SIM_SITE_URL}/signup`}
                  draggable={false}
                  className='rounded-full bg-[var(--docs-primary-fill)] px-4 py-1.5 text-[var(--docs-primary-label)] transition-colors hover:bg-[var(--docs-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 active:bg-[var(--docs-primary-pressed)]'
                >
                  Try for free
                </a>
              </div>
            </div>
            <SectionTabs pathname={pathname} mobile />
          </header>
          <div className='mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-[minmax(0,1fr)] items-start gap-x-12 pb-16 lg:grid-cols-[216px_minmax(0,1fr)] lg:px-4 lg:pt-10'>
            <aside
              key={section}
              className='sticky top-24 hidden max-h-[calc(100dvh-120px)] min-w-0 space-y-5 overflow-y-auto overscroll-contain pb-5 lg:block'
            >
              <DocsSearchTrigger />
              <SidebarNavigation nodes={navigation} pathname={pathname} />
            </aside>
            {children}
          </div>
          <footer className='mx-auto w-full max-w-[1280px] select-none px-5 pt-10 pb-8 lg:px-4'>
            <div className='flex flex-wrap items-center justify-between gap-x-10 gap-y-5'>
              <a
                href={SIM_SITE_URL}
                aria-label='Sim home'
                draggable={false}
                className='inline-flex h-8 items-center'
              >
                <SimWordmark />
              </a>
              <nav
                aria-label='Footer navigation'
                className='flex flex-wrap gap-x-6 gap-y-1 text-docs-control leading-[1.625]'
              >
                {[
                  { label: 'Documentation', href: '/introduction' },
                  { label: 'Changelog', href: `${SIM_SITE_URL}/changelog` },
                  { label: 'GitHub', href: 'https://github.com/simstudioai/sim' },
                  { label: 'Status', href: 'https://status.sim.ai' },
                  { label: 'Contact', href: `${SIM_SITE_URL}/contact` },
                  { label: 'Privacy', href: `${SIM_SITE_URL}/privacy` },
                  { label: 'Terms', href: `${SIM_SITE_URL}/terms` },
                ].map(({ label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    draggable={false}
                    className='flex min-h-11 items-center hover:underline focus-visible:outline-2 focus-visible:outline-[var(--docs-link)]'
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className='mt-7 flex flex-wrap items-center justify-between gap-4 text-[var(--docs-muted)] text-docs-control leading-5'>
              <p>© {new Date().getFullYear()} Sim</p>
              <ThemeSwitch />
            </div>
          </footer>
        </DocsNavigationDrawer>
      </DocsSearchProvider>
    </DocsNavigationContext>
  )
}
