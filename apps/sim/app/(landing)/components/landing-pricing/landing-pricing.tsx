'use client'

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  ChevronRight,
  Code2,
  Database,
  DollarSign,
  Users,
  Workflow,
} from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter'
import {
  ENTERPRISE_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
  TEAM_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/plan-configs'

const logger = createLogger('LandingPricing')

interface PricingFeature {
  icon: LucideIcon
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

// Free plan features with consistent icons
const FREE_PLAN_FEATURES: PricingFeature[] = [
  { icon: DollarSign, text: '$10 usage limit' },
  { icon: Workflow, text: 'Public template access' },
  { icon: Users, text: 'Community support' },
  { icon: Database, text: 'Limited log retention' },
  { icon: Code2, text: 'CLI/SDK Access' },
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
    price: '$20/mo',
    features: PRO_PLAN_FEATURES,
    ctaText: 'Get Started',
    featured: true,
  },
  {
    name: 'TEAM',
    tier: 'Team',
    price: '$40/mo',
    features: TEAM_PLAN_FEATURES,
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

function PricingCard({ tier, index }: { tier: PricingTier; index: number }) {
  const [isHovered, setIsHovered] = useState(false)

  const handleCtaClick = () => {
    logger.info(`Pricing CTA clicked: ${tier.name}`)
    // Add navigation logic here
  }

  return (
    <div
      className={cn(
        `${inter.className}`,
        'relative flex h-full flex-col justify-between bg-[#FEFEFE]',
        // Apply different padding based on card position
        index === 0 ? 'py-5 pr-5' : index === 3 ? 'py-5 pl-5' : 'p-5',
        // Add right border to all cards except the last one in each row
        tier.featured
          ? '' // Featured cards will handle their own borders
          : 'border-[#E7E4EF] border-r-2 last:border-r-0',
        // On larger screens (4 columns), remove right border from every 4th card
        !tier.featured && 'lg:[&:nth-child(4n)]:border-r-0',
        // On medium screens (2 columns), remove right border from every 2nd card
        !tier.featured && 'sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r-2',
        tier.featured
          ? '-mx-[2px] z-10 border-2 border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] text-white shadow-[inset_0_2px_4px_0_#9B77FF]'
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

        <ul className='space-y-3'>
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

      <div className='mt-8'>
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
  )
}

export default function LandingPricing() {
  return (
    <section id='pricing' className='px-[32px]' aria-label='Pricing plans'>
      <h2 className='sr-only'>Pricing Plans</h2>
      <div className='grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4'>
        {pricingTiers.map((tier, index) => (
          <PricingCard key={tier.name} tier={tier} index={index} />
        ))}
      </div>
    </section>
  )
}
