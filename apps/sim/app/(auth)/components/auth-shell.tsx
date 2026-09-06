import type { ReactNode } from 'react'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { LogoMark, SimWordmark } from '@/app/(landing)/components/navbar/components'

interface AuthShellProps {
  /** Centered content column (the form, status copy, etc.). */
  children: ReactNode
  /** Optional element pinned to the bottom of the shell (e.g. the support footer). */
  footer?: ReactNode
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
 * The home link starts a document navigation so the marketing theme default is
 * initialized independently of auth's forced-light context.
 *
 * The shell also owns the macOS traffic-light lane, unconditionally — every surface that
 * wears it (the `(auth)` routes, the CLI auth handoff, the invite pages) sits outside
 * workspace chrome and draws its logo where the lights are. Gating this per route left
 * whichever surface was overlooked drawing underneath them, and a route list could not
 * cover a dynamic segment like `/invite/[id]` anyway. Off the desktop shell
 * `--desktop-title-bar-height` is `0px`, so the reservation and the drag strip both
 * collapse to nothing and `.desktop-title-bar-page` is exactly `min-h-screen`.
 */
export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className='light desktop-title-bar-page relative flex flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      <DesktopTitleBarLane />
      <header>
        <nav className='mx-auto flex w-full max-w-[1446px] items-center px-12 py-4 max-sm:px-5 max-lg:px-8'>
          <a href='/' aria-label='Sim home' className='flex h-[30px] items-center'>
            <LogoMark>
              <SimWordmark />
            </LogoMark>
          </a>
        </nav>
      </header>
      <div className='flex flex-1 items-center justify-center px-4 pb-16'>
        <div className='w-full max-w-[400px]'>{children}</div>
      </div>
      {footer}
    </div>
  )
}
