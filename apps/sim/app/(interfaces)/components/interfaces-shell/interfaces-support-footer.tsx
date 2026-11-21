'use client'

import { SIM_SUPPORT_EMAIL } from '@sim/utils/site'

export function InterfacesSupportFooter() {
  return (
    <div className='pb-8 text-center text-[var(--text-muted)] text-caption leading-relaxed'>
      Need help?{' '}
      <a
        href={`mailto:${SIM_SUPPORT_EMAIL}`}
        className='text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-body)] hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
