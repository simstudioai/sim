import type { ReactNode } from 'react'
import { LogoShell } from '@/app/(landing)/components/logo-shell'

interface DesktopHandoffShellProps {
  title: string
  description: ReactNode
  /** Optional action row (a Chip CTA). Omitted on terminal, no-action screens. */
  children?: ReactNode
}

/**
 * The one frame for every browser-side page in the desktop handoffs — sign-in
 * confirm, connect interstitial, the invalid-link and finished screens.
 *
 * These are public, minimal-chrome gates shown in the visitor's own browser, so
 * they use the same {@link LogoShell} frame and type scale as the global 404 and
 * the public file-share gates rather than styling of their own. Handoff screens
 * are the first thing a new desktop user sees; they should read as Sim.
 */
export function DesktopHandoffShell({ title, description, children }: DesktopHandoffShellProps) {
  return (
    <LogoShell center>
      <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          {title}
        </h1>
        <p className='text-[var(--text-muted)] text-lg'>{description}</p>
        {children ? <div className='mt-3 flex items-center gap-2'>{children}</div> : null}
      </div>
    </LogoShell>
  )
}
