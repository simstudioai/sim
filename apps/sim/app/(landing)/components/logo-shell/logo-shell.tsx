import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'
import { LogoMark, SimWordmark } from '@/app/(landing)/components/navbar/components'

/**
 * The canonical light, logo-only page frame - a Sim wordmark linking home, no
 * marketing menus, on the platform's light tokens (the `light` class pins
 * light mode regardless of visitor theme). It is the shared base for every
 * surface that wants minimal chrome: the global 404, the academy catalog, and
 * the `(interfaces)` group (which adds a support footer). The `(auth)` group
 * uses its own `AuthShell` with the same look.
 *
 * Children decide their own layout: pass `center` for a single centered column
 * (404 message, simple gates); omit it for full-width content (catalogs, the
 * live chat overlay, which covers this frame entirely). An optional `footer`
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
      <header>
        <nav className='mx-auto flex w-full max-w-[1446px] items-center px-12 py-4 max-sm:px-5 max-lg:px-8'>
          <Link href='/' aria-label='Sim home' className='flex h-[30px] items-center'>
            <LogoMark>
              <SimWordmark />
            </LogoMark>
          </Link>
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
