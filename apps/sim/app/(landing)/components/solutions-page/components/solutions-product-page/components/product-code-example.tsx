import { cn } from '@sim/emcn'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { HOME_INSET, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import { CodeWindowGraphic } from '@/app/(landing)/components/shared/code-window-graphic'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import type { SolutionsProductCodeExampleConfig } from '@/app/(landing)/components/solutions-page/types'

interface ProductCodeExampleProps {
  example: SolutionsProductCodeExampleConfig
}

/** Shared terminal presentation for each product’s documented CLI commands. */
export function ProductCodeExample({ example }: ProductCodeExampleProps) {
  return (
    <section aria-labelledby='cli-heading' className={LANDING_GUTTER}>
      <div
        className={cn(
          HOME_INSET,
          'grid grid-cols-2 items-center gap-16 py-24 max-sm:gap-8 max-sm:py-12 max-md:grid-cols-1 max-lg:gap-10 max-lg:py-20'
        )}
      >
        <div>
          <p className='mb-5 text-[var(--text-secondary)] text-base'>From your terminal</p>
          <h2
            id='cli-heading'
            className='max-w-[18ch] text-balance font-normal text-[48px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[32px] max-lg:text-[40px]'
          >
            {example.title}
          </h2>
          <p className='mt-5 max-w-[42ch] text-[var(--text-body)] text-lg leading-relaxed max-sm:text-md'>
            {example.description}
          </p>
          <div className='mt-7'>
            <LandingCtaLink href='https://docs.sim.ai/cli' variant='outline' withArrow>
              Explore the CLI
            </LandingCtaLink>
          </div>
        </div>
        <div className='relative h-[340px] min-w-0 overflow-hidden rounded-2xl bg-[var(--surface-3)] pt-8 pl-8 max-sm:h-auto max-sm:p-3'>
          <div className='w-[calc(100%+96px)] max-sm:w-full'>
            <CodeWindowGraphic filename={example.filename} commands={example.commands} />
          </div>
          <div className='pointer-events-none absolute inset-0 max-sm:hidden'>
            <EdgeFade ground='surface' edges={['right', 'bottom']} depth='preview' />
          </div>
        </div>
      </div>
    </section>
  )
}
