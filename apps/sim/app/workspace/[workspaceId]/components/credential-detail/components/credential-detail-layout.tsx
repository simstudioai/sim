import type { ReactNode } from 'react'

interface CredentialDetailLayoutProps {
  /** Back link rendered at the start of the fixed action bar. */
  back: ReactNode
  /** Optional controls grouped at the end of the action bar. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * Page shell shared by the credential detail surfaces: a fixed action bar
 * (back link + grouped actions) above a scrollable, centered body. Surfaces
 * supply the slots and body sections; all layout chrome lives here so callsites
 * stay free of bespoke styling.
 */
export function CredentialDetailLayout({ back, actions, children }: CredentialDetailLayoutProps) {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        {back}
        {actions ? <div className='flex items-center'>{actions}</div> : null}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>{children}</div>
      </div>
    </div>
  )
}
