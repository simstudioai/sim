import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import type { SolutionsProductFeatureConfig } from '@/app/(landing)/components/solutions-page/types'

interface ProductFeatureProps {
  feature: SolutionsProductFeatureConfig
}

/** A floating product detail and a small caption, separated only by the shared grid rules. */
export function ProductFeature({ feature }: ProductFeatureProps) {
  return (
    <section
      id={feature.id}
      aria-labelledby={`${feature.id}-heading`}
      className='min-w-0 scroll-mt-32 border-[var(--border)] border-t border-b even:border-l max-md:even:border-l-0'
    >
      <div
        aria-hidden='true'
        inert
        data-product-feature-visual={feature.id}
        className='pointer-events-none relative isolate h-[460px] select-none overflow-hidden [container-type:inline-size] max-sm:h-[380px] max-xl:h-[420px]'
      >
        <div className='relative z-0 size-full'>{feature.visual}</div>
        <EdgeFade ground='canvas' edges={['right']} depth='preview' />
        <EdgeFade ground='canvas' edges={['bottom']} depth='stage' />
      </div>
      <div className='px-8 pt-5 pb-9 max-sm:px-0 max-sm:pt-2 max-sm:pb-7'>
        <h2
          id={`${feature.id}-heading`}
          className='text-balance font-normal text-[15px] text-[var(--text-primary)] leading-6'
        >
          {feature.title}
        </h2>
        <p className='mt-1 max-w-[44ch] text-balance text-[15px] text-[var(--text-secondary)] leading-6'>
          {feature.description}
        </p>
        {feature.cta && (
          <div className='mt-4'>
            <LandingCtaLink
              href={feature.cta.href}
              variant='outline'
              withArrow
              className='max-w-full'
            >
              {feature.cta.label}
            </LandingCtaLink>
          </div>
        )}
      </div>
    </section>
  )
}
