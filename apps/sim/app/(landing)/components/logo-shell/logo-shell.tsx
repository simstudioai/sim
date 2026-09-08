import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import { LogoMark } from '@/app/(landing)/components/navbar/components/logo-mark'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'

/**
 * Logo-only page frame shared by status pages and public interfaces. Interfaces
 * default to light tokens; status pages inherit the active theme. The home link
 * uses document navigation so marketing initializes its own theme store.
 *
 * Children decide their own layout: pass `center` for a single centered column
 * (404 message, simple gates); omit it for full-width content (the live chat
 * overlay, which covers this frame entirely). An optional `footer`
 * slot renders pinned at the bottom.
 */
interface LogoShellProps {
  children: ReactNode
  /** Center content in the viewport (for short messages / forms). Default: full-width. */
  center?: boolean
  /** Optional footer rendered after the content (e.g. a support footer). */
  footer?: ReactNode
  /** Status pages follow the active theme; public interfaces retain their light appearance. */
  theme?: 'light' | 'inherit'
}

export function LogoShell({ children, center = false, footer, theme = 'light' }: LogoShellProps) {
  return (
    <div
      className={cn(
        'desktop-title-bar-page relative flex flex-col bg-[var(--bg)] text-[var(--text-primary)]',
        theme === 'light' && 'light'
      )}
    >
      <DesktopTitleBarLane />
      <header>
        <nav className={cn('flex items-center py-4', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <a href='/' aria-label='Sim home' className='flex h-[30px] items-center'>
            <LogoMark>
              <SimWordmark />
            </LogoMark>
          </a>
        </nav>
      </header>
      <main
        className={cn('flex flex-1 flex-col', center && 'items-center justify-center px-4 pb-16')}
      >
        {children}
      </main>
      {footer}
    </div>
  )
}
