'use client'

import { cn } from '@sim/emcn'
import { useBrandConfig } from '@/ee/whitelabeling'

export interface SupportFooterProps {
  position?: 'fixed' | 'absolute'
}

export function SupportFooter({ position = 'fixed' }: SupportFooterProps) {
  const brandConfig = useBrandConfig()

  return (
    <div
      className={cn(
        'right-0 bottom-0 left-0 z-50 pb-8 text-center text-[var(--text-muted)] text-caption leading-relaxed',
        position
      )}
    >
      Need help?{' '}
      <a
        href={`mailto:${brandConfig.supportEmail}`}
        className='text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-body)] hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
