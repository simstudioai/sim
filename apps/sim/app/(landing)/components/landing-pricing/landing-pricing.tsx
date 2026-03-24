import { PricingGrid } from '@/app/(landing)/components/landing-pricing/components/pricing-card'

/**
 * Landing page pricing section displaying tiered pricing plans
 */
export default function LandingPricing() {
  return (
    <section id='pricing' className='px-4 pt-[23px] sm:px-0 sm:pt-[4px]' aria-label='Pricing plans'>
      <h2 className='sr-only'>Pricing Plans</h2>
      <div className='relative mx-auto w-full max-w-[1289px]'>
        <PricingGrid />
      </div>
    </section>
  )
}
