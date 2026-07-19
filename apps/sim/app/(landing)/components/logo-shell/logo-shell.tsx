import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { Navbar } from '@/app/(landing)/components/navbar'

/**
 * The canonical light, logo-only page frame - the shared {@link Navbar} in
 * `logoOnly` mode (Sim wordmark linking home, no marketing menus) on the
 * platform's light tokens (the `light` class pins light mode regardless of
 * visitor theme). It is the shared base for every surface that wants minimal
 * chrome: the global 404, and the `(interfaces)` group (which adds a support
 * footer). The `(auth)` group uses its own `AuthShell` with the same navbar.
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
}

export function LogoShell({ children, center = false, footer }: LogoShellProps) {
  return (
    <div className='light relative flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      <Navbar logoOnly />
      <main
        className={cn('flex flex-1 flex-col', center && 'items-center justify-center px-4 pb-16')}
      >
        {children}
      </main>
      {footer}
    </div>
  )
}
