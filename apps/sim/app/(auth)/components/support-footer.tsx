'use client'

import { useBrandConfig } from '@/ee/whitelabeling'

export interface SupportFooterProps {
  position?: 'fixed' | 'absolute'
}

export function SupportFooter({ position = 'fixed' }: SupportFooterProps) {
  const brandConfig = useBrandConfig()

  return (
    <div
      className={`right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[var(--landing-text-muted)] text-small leading-relaxed ${position}`}
    >
      Need help?{' '}
      <a
        href={`mailto:${brandConfig.supportEmail}`}
        className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
