'use client'

import { ChipLink, type ChipLinkProps, cn } from '@sim/emcn'
import type { PostHogEventMap } from '@/lib/posthog/events'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { trackLandingCta } from '@/app/(landing)/track-landing-cta'

type LandingCtaSize = 'compact' | 'default' | 'display'

export type LandingCtaSection = PostHogEventMap['landing_cta_clicked']['section']

interface LandingCtaLinkProps extends Omit<ChipLinkProps, 'variant'> {
  size?: LandingCtaSize
  variant?: 'primary' | 'outline'
  /** Adds the animated chevron used by demo actions. */
  withArrow?: boolean
  /**
   * Reports the click as a `landing_cta_clicked` event; the href is the
   * destination. Serializable, so Server Components can request tracking.
   */
  track?: { label: string; section: LandingCtaSection }
}

const CTA_SIZE = {
  compact: 'h-[26px] px-3 text-[13px] [--cta-arrow-icon-size:10px]',
  default: 'h-9 px-4 text-[14px] [--cta-arrow-icon-size:12px]',
  display: 'h-10 px-4 text-[14px] [--cta-arrow-icon-size:14px]',
} as const satisfies Record<LandingCtaSize, string>

interface CtaArrowProps {
  className?: string
}

function CtaArrow({ className }: CtaArrowProps) {
  return (
    <ChevronArrow className={cn(className, 'size-[var(--cta-arrow-icon-size)]')} strokeWidth={1} />
  )
}

/** Absolute http(s) destinations leave the site and need rel/target hardening. */
function isExternalHref(href: ChipLinkProps['href']): boolean {
  return typeof href === 'string' && /^https?:\/\//.test(href)
}

/**
 * Marketing pill geometry composed with the platform chip's colors and
 * interactions. An external href opens in a new tab with
 * `rel='noopener noreferrer'`, matching every other outbound link in the
 * marketing chrome; an internal href stays on the crawlable Next `<Link>`.
 */
export function LandingCtaLink({
  size = 'default',
  variant = 'primary',
  withArrow = false,
  rightIcon,
  className,
  track,
  onClick,
  ...props
}: LandingCtaLinkProps) {
  return (
    <ChipLink
      {...(isExternalHref(props.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (track) trackLandingCta({ ...track, destination: String(props.href) })
      }}
      variant={variant}
      rightIcon={withArrow ? CtaArrow : rightIcon}
      className={cn(
        'justify-center rounded-full text-center duration-150 [&>span]:[font-size:inherit]',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4',
        CTA_SIZE[size],
        withArrow && ['group/link', size === 'compact' ? 'gap-1.5 pr-2' : 'gap-2'],
        className
      )}
    />
  )
}
