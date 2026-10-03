import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

interface CredentialDetailLayoutProps {
  /** Back link rendered at the start of the fixed action bar. */
  back: ReactNode
  /** Optional controls grouped at the end of the action bar. */
  actions?: ReactNode
  /**
   * Page title, for a view whose subject is the view itself rather than a resource — the same
   * slot `SettingsPanel` fills for a detail sub-view like the Forks "Activity" page. A surface
   * that leads with a resource uses {@link CredentialDetailHeading} instead; the two are
   * alternatives, not a pair.
   */
  title?: ReactNode
  children: ReactNode
}

/**
 * Page shell shared by the credential detail surfaces: a fixed action bar
 * (back link + grouped actions) above a scrollable, centered body. Surfaces
 * supply the slots and body sections; all layout chrome lives here so callsites
 * stay free of bespoke styling.
 */
export function CredentialDetailLayout({
  back,
  actions,
  title,
  children,
}: CredentialDetailLayoutProps) {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className={cn(PAGE_HEADER_BAR, 'justify-between')}>
        {back}
        {actions ? <div className={HEADER_ACTION_CLUSTER}>{actions}</div> : null}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex w-full max-w-[48rem] flex-col gap-7 pb-6'>
          {/* Same element, class and column position the settings shell gives its page title. */}
          {title ? <h1 className='text-[var(--text-body)] text-lg'>{title}</h1> : null}
          {children}
        </div>
      </div>
    </div>
  )
}
