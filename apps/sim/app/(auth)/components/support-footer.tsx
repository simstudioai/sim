'use client'

import { inter } from '@/app/_styles/fonts/inter/inter'
import { useBrandConfig } from '@/ee/whitelabeling'

export interface SupportFooterProps {
  /** Position style - 'fixed' for pages without AuthLayout, 'absolute' for pages with AuthLayout */
  position?: 'fixed' | 'absolute'
}

/**
 * Support footer component for auth and status pages.
 * Displays a "Need help? Contact support" link using branded support email.
 *
 * @example
 * ```tsx
 * // Fixed position (for standalone pages)
 * <SupportFooter />
 *
 * // Absolute position (for pages using AuthLayout)
 * <SupportFooter position="absolute" />
 * ```
 */
export function SupportFooter({ position = 'fixed' }: SupportFooterProps) {
  const brandConfig = useBrandConfig()

  return (
    <div
      className={`${inter.className} auth-text-muted right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed ${position}`}
    >
      Need help?{' '}
      <a
        href={`mailto:${brandConfig.supportEmail}`}
        className='auth-link underline-offset-4 transition hover:underline'
      >
        Contact support
      </a>
    </div>
  )
}
