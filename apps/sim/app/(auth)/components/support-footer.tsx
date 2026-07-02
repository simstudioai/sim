'use client'

import { cn } from '@sim/emcn'
import { useBrandConfig } from '@/ee/whitelabeling'

export interface SupportFooterProps {
  /**
   * `fixed`/`absolute` pin the footer over the page (short, centered forms
   * only — content must never render underneath it). `static` renders it in
   * normal document flow after the content, which is required for pages with
   * unbounded content height (e.g. the resume gate's HITL form): an
   * absolutely-positioned footer with no reserved space is not pushed down by
   * flow content, so it silently overlaps and eats clicks on whatever content
   * ends up in its footprint.
   */
  position?: 'fixed' | 'absolute' | 'static'
}

export function SupportFooter({ position = 'fixed' }: SupportFooterProps) {
  const brandConfig = useBrandConfig()

  return (
    <div
      className={cn(
        'pb-8 text-center text-[var(--text-muted)] text-caption leading-relaxed',
        position !== 'static' && 'right-0 bottom-0 left-0 z-50',
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
