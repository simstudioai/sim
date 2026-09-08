import { cn } from '@sim/emcn'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { ProductCodeExample } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-code-example'
import { ProductFeature } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-feature'
import { ProductShowcase } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-showcase'
import { SolutionsStructuredData } from '@/app/(landing)/components/solutions-page/components/solutions-structured-data'
import type { SolutionsProductPageConfig } from '@/app/(landing)/components/solutions-page/types'

interface SolutionsProductPageProps {
  config: SolutionsProductPageConfig
}

/** Wide product illustrations share an open canvas, with compact captions on a fine grid. */
export function SolutionsProductPage({ config }: SolutionsProductPageProps) {
  const [showcase, ...features] = config.features

  return (
    <>
      <SolutionsStructuredData config={config} />
      <main id='main-content' className={LANDING_CONTENT_WIDTH}>
        <section
          aria-labelledby='product-heading'
          className='border-[var(--border)] border-b pb-24 max-sm:pb-14 max-lg:pb-20'
        >
          <div className='px-3 max-sm:px-0'>{config.hero.visual}</div>
          <div className={LANDING_GUTTER}>
            <div className={cn(HOME_INSET, 'pt-5 text-center max-sm:pt-0')}>
              <p className='sr-only'>{config.hero.summary}</p>
              <p className='mb-6 text-[15px] text-[var(--text-secondary)]'>Sim / {config.module}</p>
              <h1
                id='product-heading'
                className='mx-auto max-w-[20ch] text-balance font-normal text-[80px] text-[var(--text-primary)] leading-[1.02] tracking-[-0.035em] max-sm:text-[44px] max-lg:text-[64px]'
              >
                {config.hero.heading}
              </h1>
            </div>
          </div>
        </section>
        {showcase && <ProductShowcase feature={showcase} description={config.hero.description} />}
        <div className={LANDING_GUTTER}>
          <div
            className={cn(
              HOME_INSET,
              'grid grid-cols-2 border-[var(--border)] border-x max-sm:border-x-0 max-md:grid-cols-1'
            )}
          >
            {features.map((feature) => (
              <ProductFeature key={feature.id} feature={feature} />
            ))}
          </div>
        </div>
        {config.codeExample && <ProductCodeExample example={config.codeExample} />}
      </main>
    </>
  )
}
