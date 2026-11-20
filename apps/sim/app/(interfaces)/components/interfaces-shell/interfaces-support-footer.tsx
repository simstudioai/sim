'use client'

import { SUPPORT_EMAIL } from '@/lib/branding/contact'

export function InterfacesSupportFooter() {
  return (
    <div className='pb-8 text-center text-[var(--text-muted)] text-caption leading-relaxed'>
      Need help?{' '}
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className='text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-body)] hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
