'use client'

import { useBrandConfig } from '@/ee/whitelabeling'

export function InterfacesSupportFooter() {
  const brand = useBrandConfig()
  return (
    <div className='pb-8 text-center text-[var(--text-muted)] text-caption leading-relaxed'>
      Need help?{' '}
      <a
        href={`mailto:${brand.supportEmail}`}
        className='text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-body)] hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
