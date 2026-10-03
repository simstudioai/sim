import { cn } from '@sim/emcn'
import {
  type AgentMomentumMetric,
  AgentMomentumMetrics,
} from '@/app/(landing)/components/agent-momentum/agent-momentum-metrics'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

const METRICS: readonly AgentMomentumMetric[] = [
  {
    value: 20_000_000,
    prefix: '$',
    compact: true,
    description: 'dollars saved by teams using Sim to automate their work',
  },
  {
    value: 1_270_000,
    compact: true,
    description: 'hours of work completed in Sim',
  },
  {
    value: 100_000,
    suffix: '+',
    description: 'builders already using Sim to create and manage AI agents',
  },
] as const

/**
 * Editorial proof section showing the impact and adoption of Sim.
 *
 * It shares a close-spaced group with the customer film, so the two read as
 * one beat. There is no rule above it, and it closes on a
 * hairline that runs the full width of the page, edge to edge, while the copy
 * and the metrics stay inside the content column. The rule lands right under
 * the last metric row, the same distance its own dividers keep.
 */
export function AgentMomentum() {
  return (
    <section
      id='agent-momentum'
      aria-label='AI agent momentum'
      className='flex w-full flex-col border-[var(--border)] border-b'
    >
      <div
        className={cn(
          'grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-x-24 max-lg:grid-cols-1 max-lg:gap-x-0',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER
        )}
      >
        <div className='pt-8 pr-12 max-sm:pt-6 max-lg:pr-0'>
          <p className='max-w-[40rem] text-pretty text-[30px] text-[var(--text-primary)] leading-[1.3] tracking-[-0.015em] max-sm:text-[22px] max-xl:text-[26px]'>
            The world’s work is moving to AI agents. Sim gives teams one place to build, deploy,
            monitor and govern every agent across the business.
          </p>
        </div>

        <AgentMomentumMetrics metrics={METRICS} />
      </div>
    </section>
  )
}
