import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'
import { LogoMark, SimWordmark } from '@/app/(landing)/components/navbar/components'

interface AuthShellProps {
  /** Centered content column (the form, status copy, etc.). */
  children: ReactNode
  /** Optional element pinned to the bottom of the shell (e.g. the support footer). */
  footer?: ReactNode
  /** Reserve the native macOS title-bar lane for the desktop login route. */
  reserveDesktopTitleBar?: boolean
}

/**
 * The light auth/status page frame — the single source of truth for the shell
 * every auth page and standalone status page wears.
 *
 * Mirrors the landing chrome: it pins the `light` token layer (so the platform's
 * light-mode `var(--*)` tokens resolve regardless of the visitor's theme), uses
 * the canvas/`--text-primary` surface, and renders a logo-only header that reuses
 * the landing {@link LogoMark} + {@link SimWordmark} at the same nav gutters. The
 * single content column is centered and capped for a calm single-form layout.
 */
export function AuthShell({ children, footer, reserveDesktopTitleBar = false }: AuthShellProps) {
  return (
    <div
      className={cn(
        'light relative flex flex-col bg-[var(--bg)] text-[var(--text-primary)]',
        reserveDesktopTitleBar ? 'desktop-title-bar-page' : 'min-h-screen'
      )}
    >
      {reserveDesktopTitleBar && (
        <div aria-hidden className='desktop-login-window-drag-region desktop-window-drag-region' />
      )}
      <header>
        <nav className='mx-auto flex w-full max-w-[1446px] items-center px-12 py-4 max-sm:px-5 max-lg:px-8'>
          <Link href='/' aria-label='Sim home' className='flex h-[30px] items-center'>
            <LogoMark>
              <SimWordmark />
            </LogoMark>
          </Link>
        </nav>
      </header>
      <div className='flex flex-1 items-center justify-center px-4 pb-16'>
        <div className='w-full max-w-[400px]'>{children}</div>
      </div>
      {footer}
    </div>
  )
}
