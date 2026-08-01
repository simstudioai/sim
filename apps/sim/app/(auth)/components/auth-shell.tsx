import type { ReactNode } from 'react'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { Navbar } from '@/app/(landing)/components/navbar'

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
 * the canvas/`--text-primary` surface, and renders the shared {@link Navbar} in
 * `logoOnly` mode — the same wordmark, geometry, and hover as the landing bar.
 * The single content column is centered and capped for a calm single-form layout.
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
      <Navbar logoOnly />
      <div className='flex flex-1 items-center justify-center px-4 pb-16'>
        <div className='w-full max-w-[400px]'>{children}</div>
      </div>
      {footer}
    </div>
  )
}
