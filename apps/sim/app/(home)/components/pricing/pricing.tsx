import Link from 'next/link'
import { Badge } from '@/components/emcn'
import { DemoRequestModal } from '@/app/(home)/components/demo-request/demo-request-modal'

interface PricingTier {
  id: string
  name: string
  description: string
  price: string
  billingPeriod?: string
  color: string
  features: string[]
  cta: { label: string; href?: string; action?: 'demo-request' }
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
      '3 tables · 1,000 rows each',
      '5 min execution limit',
      '5 concurrent/workspace',
      '7-day log retention',
      'CLI/SDK/MCP Access',
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
      '6,000 credits/mo · +50/day',
      '50GB file storage',
      '25 tables · 5,000 rows each',
      '50 min execution · 150 runs/min',
      '50 concurrent/workspace',
      'Unlimited log retention',
      'CLI/SDK/MCP Access',
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
      '25,000 credits/mo · +200/day',
      '500GB file storage',
      '25 tables · 5,000 rows each',
      '50 min execution · 300 runs/min',
      '200 concurrent/workspace',
      'Unlimited log retention',
      'CLI/SDK/MCP Access',
    ],
    cta: { label: 'Get started', href: '/signup' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For organizations needing security and scale',
    price: 'Custom',
    color: '#FFCC02',
    features: [
      'Custom credits & infra limits',
      'Custom file storage',
      '10,000 tables · 1M rows each',
      'Custom execution limits',
      'Custom concurrency limits',
      'Unlimited log retention',
      'SSO & SCIM · SOC2',
      'Self hosting · Dedicated support',
    ],
    cta: { label: 'Book a demo', action: 'demo-request' },
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
  const isDemoRequest = tier.cta.action === 'demo-request'
  const isPro = tier.id === 'pro'

  return (
    <article className='flex flex-1 flex-col' aria-labelledby={`${tier.id}-heading`}>
      <div className='flex flex-1 flex-col gap-6 rounded-t-lg border border-[var(--landing-border-light)] border-b-0 bg-white p-5'>
        <div className='flex flex-col'>
          <h3
            id={`${tier.id}-heading`}
            className='font-[430] font-season text-[24px] text-[var(--landing-text-dark)] leading-[100%] tracking-[-0.02em]'
          >
            {tier.name}
          </h3>
          <p className='mt-2 min-h-[44px] font-[430] font-season text-[#5c5c5c] text-sm leading-[125%] tracking-[0.02em]'>
            {tier.description}
          </p>
          <p className='mt-4 flex items-center gap-1.5 font-[430] font-season text-[20px] text-[var(--landing-text-dark)] leading-[100%] tracking-[-0.02em]'>
            {tier.price}
            {tier.billingPeriod && (
              <span className='text-[#737373] text-md'>{tier.billingPeriod}</span>
            )}
          </p>
          <div className='mt-4'>
            {isDemoRequest ? (
              <DemoRequestModal theme='light'>
                <button
                  type='button'
                  className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[var(--landing-border-light)] bg-transparent px-2.5 font-[430] font-season text-[14px] text-[var(--landing-text-dark)] transition-colors hover:bg-[var(--landing-bg-hover)]'
                >
                  {tier.cta.label}
                </button>
              </DemoRequestModal>
            ) : isPro ? (
              <Link
                href={tier.cta.href || '/signup'}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#1D1D1D] bg-[#1D1D1D] px-2.5 font-[430] font-season text-[14px] text-white transition-colors hover:border-[var(--landing-border)] hover:bg-[var(--landing-bg-elevated)]'
              >
                {tier.cta.label}
              </Link>
            ) : (
              <Link
                href={tier.cta.href || '/signup'}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[var(--landing-border-light)] px-2.5 font-[430] font-season text-[14px] text-[var(--landing-text-dark)] transition-colors hover:bg-[var(--landing-bg-hover)]'
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
              <span className='font-[400] font-season text-[#5c5c5c] text-sm leading-[125%] tracking-[0.02em]'>
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
    <section
      id='pricing'
      aria-labelledby='pricing-heading'
      className='bg-[var(--landing-bg-section)]'
    >
      <div className='px-4 pt-[60px] pb-10 sm:px-8 sm:pt-20 sm:pb-0 md:px-20 md:pt-[100px]'>
        <div className='flex flex-col items-start gap-3 sm:gap-4 md:gap-5'>
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
            className='text-balance font-[430] font-season text-[32px] text-[var(--landing-text-dark)] leading-[100%] tracking-[-0.02em] sm:text-[36px] md:text-[40px]'
          >
            Pricing
          </h2>
        </div>

        <div className='mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 md:mt-12 lg:grid-cols-4'>
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
      </div>
    </section>
  )
}
