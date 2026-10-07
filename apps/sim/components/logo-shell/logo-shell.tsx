import type { ReactNode } from 'react'
import { LogoPage, SimWordmark } from '@sim/emcn'
import { LogoMark } from '@/components/logo-mark'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'

/**
 * Logo-only page frame shared by status pages and public interfaces. Interfaces
 * default to light tokens; status pages inherit the active theme. The home link
 * uses document navigation across the independently served website boundary.
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
    <LogoPage
      className='desktop-title-bar-page'
      titleBar={<DesktopTitleBarLane />}
      center={center}
      theme={theme}
      footer={footer}
      logo={
        <a href='/' aria-label='Sim home' className='flex h-[30px] items-center'>
          <LogoMark>
            <SimWordmark />
          </LogoMark>
        </a>
      }
    >
      {children}
    </LogoPage>
  )
}
