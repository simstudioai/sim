import { cn } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { HOME_INSET, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import { CodeWindowGraphic } from '@/app/(landing)/components/shared/code-window-graphic'
import type { SolutionsProductCodeExampleConfig } from '@/app/(landing)/components/solutions-page/types'

interface ProductCodeExampleProps {
  example: SolutionsProductCodeExampleConfig
}

/** Server-rendered code keeps the original editor graphic without another interactive island. */
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
        <div className='min-w-0 overflow-hidden rounded-xl bg-[var(--text-secondary)] pt-8 pl-8 max-sm:pt-5 max-sm:pl-5 dark:bg-[var(--surface-3)]'>
          <CodeWindowGraphic
            icon={<TerminalWindow className='size-[14px] text-[var(--text-muted-inverse)]' />}
            filename={example.filename}
            lines={example.commands.map((command) => [{ text: command, tone: 'primary' }])}
          />
        </div>
      </div>
    </section>
  )
}
