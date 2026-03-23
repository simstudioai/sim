'use client'

import type { ComponentType, SVGProps } from 'react'
import { useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  ArrowRight,
  ChevronRight,
  Code2,
  Database,
  DollarSign,
  HardDrive,
  type LucideIcon,
  RefreshCw,
  Timer,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { ENTERPRISE_PLAN_FEATURES } from '@/app/workspace/[workspaceId]/settings/components/subscription/plan-configs'

const logger = createLogger('LandingPricing')

interface PricingFeature {
  icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>
  text: string
}

interface PricingTier {
  name: string
  tier: string
  price: string
  features: PricingFeature[]
  ctaText: string
  featured?: boolean
}

const FREE_PLAN_FEATURES: PricingFeature[] = [
  { icon: DollarSign, text: '1,000 credits (trial)' },
  { icon: HardDrive, text: '5GB file storage' },
  { icon: Timer, text: '5 min execution limit' },
  { icon: Database, text: 'Limited log retention' },
  { icon: Code2, text: 'CLI/SDK Access' },
]

const PRO_LANDING_FEATURES: PricingFeature[] = [
  { icon: DollarSign, text: '6,000 credits/mo' },
  { icon: RefreshCw, text: '+50 daily refresh credits' },
  { icon: Zap, text: '150 runs/min (sync)' },
  { icon: Timer, text: '50 min sync execution limit' },
  { icon: HardDrive, text: '50GB file storage' },
]

const MAX_LANDING_FEATURES: PricingFeature[] = [
  { icon: DollarSign, text: '25,000 credits/mo' },
  { icon: RefreshCw, text: '+200 daily refresh credits' },
  { icon: Zap, text: '300 runs/min (sync)' },
  { icon: Timer, text: '50 min sync execution limit' },
  { icon: HardDrive, text: '500GB file storage' },
]

const pricingTiers: PricingTier[] = [
  {
    name: 'COMMUNITY',
    tier: 'Free',
    price: 'Free',
    features: FREE_PLAN_FEATURES,
    ctaText: 'Get Started',
  },
  {
    name: 'PRO',
    tier: 'Pro',
    price: '$25/mo',
    features: PRO_LANDING_FEATURES,
    ctaText: 'Get Started',
    featured: true,
  },
  {
    name: 'MAX',
    tier: 'Max',
    price: '$100/mo',
    features: MAX_LANDING_FEATURES,
    ctaText: 'Get Started',
  },
  {
    name: 'ENTERPRISE',
    tier: 'Enterprise',
    price: 'Custom',
    features: ENTERPRISE_PLAN_FEATURES,
    ctaText: 'Contact Sales',
  },
]

function PricingCard({
  tier,
  isBeforeFeatured,
}: {
  tier: PricingTier
  isBeforeFeatured?: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)
  const router = useRouter()

  const handleCtaClick = () => {
    logger.info(`Pricing CTA clicked: ${tier.name}`)

    if (tier.ctaText === 'Contact Sales') {
      window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
    } else {
      router.push('/signup')
    }
  }

  return (
    <div
      className={cn(
        'relative flex h-full flex-col justify-between bg-[#FEFEFE]',
        tier.featured ? 'p-0' : 'px-0 py-0',
        'sm:px-5 sm:pt-4 sm:pb-4',
        tier.featured
          ? 'sm:p-0'
          : isBeforeFeatured
            ? 'sm:border-[#E7E4EF] sm:border-r-0'
            : 'sm:border-[#E7E4EF] sm:border-r-2 sm:last:border-r-0',
        !tier.featured && !isBeforeFeatured && 'lg:[&:nth-child(4n)]:border-r-0',
        !tier.featured &&
          !isBeforeFeatured &&
          'sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r-2',
        tier.featured ? 'z-10 bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] text-white' : ''
      )}
    >
      <div
        className={cn(
          'flex h-full flex-col justify-between',
          tier.featured
            ? 'border-2 border-[#6F3DFA] px-5 pt-4 pb-5 shadow-[inset_0_2px_4px_0_#9B77FF] sm:px-5 sm:pt-4 sm:pb-4'
            : ''
        )}
      >
        <div className='flex-1'>
          <div className='mb-1'>
            <span
              className={cn(
                'font-medium text-xs uppercase tracking-wider',
                tier.featured ? 'text-white/90' : 'text-gray-500'
              )}
            >
              {tier.name}
            </span>
          </div>
          <div className='mb-6'>
            <span
              className={cn(
                'font-medium text-4xl leading-none',
                tier.featured ? 'text-white' : 'text-black'
              )}
            >
              {tier.price}
            </span>
          </div>

          <ul className='mb-[2px] space-y-3'>
            {tier.features.map((feature, idx) => (
              <li key={idx} className='flex items-start gap-2'>
                <feature.icon
                  className={cn(
                    'mt-0.5 h-4 w-4 flex-shrink-0',
                    tier.featured ? 'text-white/90' : 'text-gray-600'
                  )}
                />
                <span className={cn('text-sm', tier.featured ? 'text-white' : 'text-gray-700')}>
                  {feature.text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className='mt-9'>
          {tier.featured ? (
            <button
              onClick={handleCtaClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className='group inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#E8E8E8] bg-gradient-to-b from-[#F8F8F8] to-white px-3 py-[6px] font-medium text-[#6F3DFA] text-[14px] shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.9)] transition-all'
            >
              <span className='flex items-center gap-1'>
                {tier.ctaText}
                <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                  {isHovered ? (
                    <ArrowRight className='h-4 w-4' />
                  ) : (
                    <ChevronRight className='h-4 w-4' />
                  )}
                </span>
              </span>
            </button>
          ) : (
            <button
              onClick={handleCtaClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className='group inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#343434] bg-gradient-to-b from-[#060606] to-[#323232] px-3 py-[6px] font-medium text-[14px] text-white shadow-[inset_0_1.25px_2.5px_0_#9B77FF] transition-all'
            >
              <span className='flex items-center gap-1'>
                {tier.ctaText}
                <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                  {isHovered ? (
                    <ArrowRight className='h-4 w-4' />
                  ) : (
                    <ChevronRight className='h-4 w-4' />
                  )}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Pricing grid with all tier cards. Rendered as a client component because
 * the tier data contains component references (icon functions) which are
 * not serializable across the RSC boundary.
 */
export function PricingGrid() {
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-0 lg:grid-cols-4'>
      {pricingTiers.map((tier, index) => {
        const nextTier = pricingTiers[index + 1]
        const isBeforeFeatured = nextTier?.featured
        return <PricingCard key={tier.name} tier={tier} isBeforeFeatured={isBeforeFeatured} />
      })}
    </div>
  )
}
