'use client'

import { ChipLink, type ChipLinkProps, cn } from '@sim/emcn'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'

type LandingCtaSize = 'compact' | 'default' | 'display'

interface LandingCtaLinkProps extends Omit<ChipLinkProps, 'variant'> {
  size?: LandingCtaSize
  variant?: 'primary' | 'outline'
  /** Adds the animated chevron used by demo actions. */
  withArrow?: boolean
}

const CTA_SIZE = {
  compact: 'h-[26px] px-2 text-[13px] [--cta-arrow-icon-size:10px]',
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

/** Marketing pill geometry composed with the platform chip's colors and interactions. */
export function LandingCtaLink({
  size = 'default',
  variant = 'primary',
  withArrow = false,
  rightIcon,
  className,
  ...props
}: LandingCtaLinkProps) {
  return (
    <ChipLink
      {...props}
      variant={variant}
      rightIcon={withArrow ? CtaArrow : rightIcon}
      className={cn(
        'justify-center rounded-full text-center duration-150 [&>span]:[font-size:inherit]',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4',
        CTA_SIZE[size],
        withArrow && ['group/link', size === 'compact' ? 'gap-1.5 pl-3' : 'gap-2'],
        className
      )}
    />
  )
}
