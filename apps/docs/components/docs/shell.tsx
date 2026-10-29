'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from '@sim/emcn/icons'
import Link from 'next/link'
import { cn } from '@/components/docs/classnames'
import { SidebarNavigation } from '@/components/docs/navigation'
import { DocsSearchProvider, DocsSearchTrigger } from '@/components/docs/search'
import { TableOfContents } from '@/components/docs/table-of-contents'
import { ThemeSwitch } from '@/components/docs/theme'
import { SimWordmark } from '@/components/ui/sim-logo'
import type { DocsHeading, NavNode } from '@/lib/content/types'
import { DOCS_SECTIONS, getDocsSection } from '@/lib/navigation'
import { SIM_SITE_URL } from '@/lib/urls'

interface DocsShellProps {
  children: ReactNode
  navigation: NavNode[]
  pathname: string
  headings: DocsHeading[]
  api?: boolean
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
          aria-current={tab.slug === section ? 'page' : undefined}
          className={cn(
            'flex h-full shrink-0 items-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4',
            tab.slug === section && 'font-medium'
          )}
        >
          {mobile ? tab.compactLabel : tab.label}
        </Link>
      ))}
    </nav>
  )
}

/** Shared responsive reading frame; article children remain server-rendered. */
export function DocsShell({
  children,
  navigation,
  pathname,
  headings,
  api = false,
}: DocsShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  return (
    <DocsSearchProvider>
      <header className='sticky top-0 z-40 bg-[var(--docs-glass)] backdrop-blur-[20px]'>
        <div className='mx-auto flex h-14 max-w-[1280px] items-center gap-10 px-5 lg:px-4'>
          <Link
            href='/introduction'
            aria-label='Sim documentation home'
            className='shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4'
          >
            <SimWordmark className='-translate-y-0.5 h-auto w-10' />
          </Link>
          <SectionTabs pathname={pathname} />
          <div className='ml-auto flex items-center gap-2 font-[450] text-docs-header'>
            <a
              href={`${SIM_SITE_URL}/contact`}
              className='hidden rounded-full bg-[var(--docs-surface)] px-4 py-1.5 text-[var(--docs-heading)] transition-colors hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] sm:block'
            >
              Contact sales
            </a>
            <a
              href={`${SIM_SITE_URL}/signup`}
              className='rounded-full bg-[var(--docs-heading)] px-4 py-1.5 text-[var(--docs-canvas)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2'
            >
              Try for free
            </a>
          </div>
        </div>
        <SectionTabs pathname={pathname} mobile />
        <div className='flex h-11 items-center justify-between border-[var(--docs-border)] border-y px-5 lg:hidden'>
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger className='flex min-h-11 items-center gap-2 text-docs-control'>
              <Menu className='size-4' />
              Menu
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className='fixed inset-0 z-50 bg-black/20 backdrop-blur-sm' />
              <Dialog.Content className='docs-root fixed inset-y-0 left-0 z-50 flex w-[min(340px,100vw-32px)] flex-col border-[var(--docs-border)] border-r bg-[var(--docs-canvas)] p-5 shadow-xl'>
                <div className='mb-5 flex items-center justify-between'>
                  <Dialog.Title className='text-docs-nav'>Documentation</Dialog.Title>
                  <Dialog.Close
                    aria-label='Close navigation'
                    className='flex size-11 items-center justify-center rounded-lg hover:bg-[var(--docs-hover)]'
                  >
                    <X className='size-4' />
                  </Dialog.Close>
                </div>
                <Dialog.Description className='sr-only'>
                  Browse the current documentation section.
                </Dialog.Description>
                <DocsSearchTrigger />
                <div className='mt-5 min-h-0 flex-1 overflow-y-auto pb-6'>
                  <SidebarNavigation
                    nodes={navigation}
                    pathname={pathname}
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </div>
                <ThemeSwitch />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <DocsSearchTrigger compact />
          <TableOfContents headings={headings} compact />
        </div>
      </header>
      <div
        className={cn(
          'mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-[minmax(0,1fr)] items-start gap-x-12 px-5 pt-7 pb-16 md:pt-10 lg:grid-cols-[216px_minmax(0,1fr)] lg:px-4',
          api
            ? 'xl:grid-cols-[216px_minmax(0,1fr)]'
            : 'xl:grid-cols-[216px_minmax(0,680px)_minmax(0,208px)]'
        )}
      >
        <aside className='sticky top-24 hidden max-h-[calc(100dvh-120px)] min-w-0 space-y-5 overflow-y-auto overscroll-contain pb-5 lg:block'>
          <DocsSearchTrigger />
          <SidebarNavigation nodes={navigation} pathname={pathname} />
        </aside>
        <div className='min-w-0'>
          {!api && (
            <div className='mb-4 hidden justify-end lg:flex xl:hidden'>
              <TableOfContents headings={headings} compact />
            </div>
          )}
          {children}
        </div>
        {!api && (
          <aside className='sticky top-24 hidden max-h-[calc(100dvh-120px)] overflow-y-auto pb-5 xl:block'>
            <TableOfContents headings={headings} />
          </aside>
        )}
      </div>
      <footer className='mx-auto w-full max-w-[1280px] px-5 pt-10 pb-8 lg:px-4'>
        <div className='flex flex-wrap items-center justify-between gap-x-10 gap-y-5'>
          <a href={SIM_SITE_URL} aria-label='Sim home'>
            <SimWordmark className='h-auto w-10' />
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
              <a
                key={label}
                href={href}
                className='flex min-h-11 items-center hover:underline focus-visible:outline-2 focus-visible:outline-[var(--docs-link)]'
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className='mt-7 flex flex-wrap items-center justify-between gap-4 text-[var(--docs-muted)] text-docs-control leading-5'>
          <p>© {new Date().getFullYear()} Sim</p>
          <ThemeSwitch />
        </div>
      </footer>
    </DocsSearchProvider>
  )
}
