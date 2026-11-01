import type { ReactNode } from 'react'
import { Banner } from '@sim/emcn'

interface BrowserNoticeProps {
  message: ReactNode
  actions: ReactNode
}

/** A non-modal notice docked under the browser toolbar; a long message wraps rather than truncating. */
export function BrowserNotice({ message, actions }: BrowserNoticeProps) {
  return (
    <Banner className='border-[var(--border)] border-t bg-[var(--surface-3)] px-3 py-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <p className='min-w-0 text-[var(--text-secondary)] text-small'>{message}</p>
        <div className='flex shrink-0 items-center gap-0.5'>{actions}</div>
      </div>
    </Banner>
  )
}
