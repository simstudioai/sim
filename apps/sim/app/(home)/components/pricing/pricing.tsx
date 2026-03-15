import Link from 'next/link'
import { Badge } from '@/components/emcn'

interface PricingTier {
  id: string
  name: string
  description: string
  price: string
  billingPeriod?: string
  color: string
  features: string[]
  cta: { label: string; href: string }
}

const PRICING_TIERS: PricingTier[] = [
  {
    id: 'community',
    name: 'Community',
    description: 'For individuals getting started with AI agents',
    price: 'Free',
    color: '#2ABBF8',
    features: [
      '1,000 credits (trial)',
      '5GB file storage',
      '5 min execution limit',
      'Limited log retention',
      'CLI/SDK Access',
    ],
    cta: { label: 'Get started', href: '/signup' },
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For professionals building production workflows',
    price: '$25',
    billingPeriod: 'per month',
    color: '#00F701',
    features: [
      '6,000 credits/mo',
      '+50 daily refresh credits',
      '150 runs/min (sync)',
      '50 min sync execution limit',
      '50GB file storage',
    ],
    cta: { label: 'Get started', href: '/signup' },
  },
  {
    id: 'max',
    name: 'Max',
    description: 'For power users and teams building at scale',
    price: '$100',
    billingPeriod: 'per month',
    color: '#FA4EDF',
    features: [
      '25,000 credits/mo',
      '+200 daily refresh credits',
      '300 runs/min (sync)',
      '50 min sync execution limit',
      '500GB file storage',
    ],
    cta: { label: 'Get started', href: '/signup' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For organizations needing security and scale',
    price: 'Custom',
    color: '#FFCC02',
    features: ['Custom infra limits', 'SSO', 'SOC2', 'Self hosting', 'Dedicated support'],
    cta: { label: 'Book a demo', href: '/contact' },
  },
]

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <path
        d='M2.5 7L5.5 10L11.5 4'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

interface PricingCardProps {
  tier: PricingTier
}

function PricingCard({ tier }: PricingCardProps) {
  const isEnterprise = tier.id === 'enterprise'
  const isPro = tier.id === 'pro'

  return (
    <article className='flex flex-1 flex-col' aria-labelledby={`${tier.id}-heading`}>
      <div className='flex flex-1 flex-col gap-6 rounded-t-lg border border-[#E5E5E5] border-b-0 bg-white p-5'>
        <div className='flex flex-col'>
          <h3
            id={`${tier.id}-heading`}
            className='font-[430] font-season text-[#1C1C1C] text-[24px] leading-[100%] tracking-[-0.02em]'
          >
            {tier.name}
          </h3>
          <p className='mt-2 min-h-[44px] font-[430] font-season text-[#5c5c5c] text-[14px] leading-[125%] tracking-[0.02em]'>
            {tier.description}
          </p>
          <p className='mt-4 flex items-center gap-1.5 font-[430] font-season text-[#1C1C1C] text-[20px] leading-[100%] tracking-[-0.02em]'>
            {tier.price}
            {tier.billingPeriod && (
              <span className='text-[#737373] text-[16px]'>{tier.billingPeriod}</span>
            )}
          </p>
          <div className='mt-4'>
            {isEnterprise ? (
              <a
                href={tier.cta.href}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#E5E5E5] px-[10px] font-[430] font-season text-[#1C1C1C] text-[14px] transition-colors hover:bg-[#F0F0F0]'
              >
                {tier.cta.label}
              </a>
            ) : isPro ? (
              <Link
                href={tier.cta.href}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#1D1D1D] bg-[#1D1D1D] px-[10px] font-[430] font-season text-[14px] text-white transition-colors hover:border-[#2A2A2A] hover:bg-[#2A2A2A]'
              >
                {tier.cta.label}
              </Link>
            ) : (
              <Link
                href={tier.cta.href}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#E5E5E5] px-[10px] font-[430] font-season text-[#1C1C1C] text-[14px] transition-colors hover:bg-[#F0F0F0]'
              >
                {tier.cta.label}
              </Link>
            )}
          </div>
        </div>

        <ul className='flex flex-col gap-2'>
          {tier.features.map((feature) => (
            <li key={feature} className='flex items-center gap-2'>
              <CheckIcon color='#404040' />
              <span className='font-[400] font-season text-[#5c5c5c] text-[14px] leading-[125%] tracking-[0.02em]'>
                {feature}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className='relative h-[6px]'>
        <div
          className='absolute inset-0 rounded-b-sm opacity-60'
          style={{ backgroundColor: tier.color }}
        />
        <div
          className='absolute top-0 right-0 bottom-0 left-[12%] rounded-b-sm opacity-60'
          style={{ backgroundColor: tier.color }}
        />
        <div
          className='absolute top-0 right-0 bottom-0 left-[25%] rounded-b-sm'
          style={{ backgroundColor: tier.color }}
        />
      </div>
    </article>
  )
}

/**
 * Pricing section -- tiered pricing plans with feature comparison.
 */
export default function Pricing() {
  return (
    <section id='pricing' aria-labelledby='pricing-heading' className='bg-[#F6F6F6]'>
      <div className='px-4 pt-[100px] pb-[80px] sm:px-8 md:px-[80px]'>
        <div className='flex flex-col items-start gap-3 sm:gap-4 md:gap-[20px]'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='bg-[#2ABBF8]/10 font-season text-[#2ABBF8] uppercase tracking-[0.02em]'
          >
            Pricing
          </Badge>

          <h2
            id='pricing-heading'
            className='font-[430] font-season text-[#1C1C1C] text-[32px] leading-[100%] tracking-[-0.02em] sm:text-[36px] md:text-[40px]'
          >
            Pricing
          </h2>
        </div>

        <div className='mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
      </div>
    </section>
  )
}
