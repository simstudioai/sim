import type { ComponentType, SVGProps } from 'react'
import {
  BuildIcon,
  DeployIcon,
  MonitorIcon,
} from '@/app/(landing)/components/lifecycle/components/lifecycle-icons'

/**
 * Landing lifecycle - the three axes along which teams use Sim: build, deploy,
 * monitor. A split-statement `<h2>` (headline color + body color, matching the
 * features header) tops a three-column grid; each column pairs an isometric
 * line-art icon with an `<h3>` axis title and a one-line description.
 *
 * The columns carry a left hairline (`--border`) for the technical, reference-
 * style rhythm; the icon area is `flex-1` so the three titles bottom-align
 * regardless of icon height. Icons inherit `--text-muted` via `currentColor`.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the navbar and hero so the headline starts on the wordmark's line, and the
 * section is capped and centered at the shared `max-w-[1446px]`. First
 * section after the hero, above {@link Features}.
 */

interface Axis {
  title: string
  description: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const AXES: Axis[] = [
  {
    title: 'Build',
    description:
      'Build agents visually, in natural language, or with code, wiring up any model and 1,000+ integrations.',
    Icon: BuildIcon,
  },
  {
    title: 'Deploy',
    description:
      'Ship agents to production as APIs, Slack bots, or scheduled jobs, live in a click.',
    Icon: DeployIcon,
  },
  {
    title: 'Monitor',
    description: 'Trace every run block by block, with full logs of what each agent did and why.',
    Icon: MonitorIcon,
  },
]

export function Lifecycle() {
  return (
    <section
      id='lifecycle'
      aria-labelledby='lifecycle-heading'
      className='mx-auto w-full max-w-[1446px] px-12'
    >
      <h2 id='lifecycle-heading' className='max-w-[1200px] text-balance text-[32px] leading-[1.3]'>
        <span className='text-[var(--text-primary)]'>From idea to production.</span>{' '}
        <span className='text-[var(--text-body)]'>
          Build agents, deploy them, and monitor every run, all in one workspace.
        </span>
      </h2>

      <ul className='mt-20 grid grid-cols-3 gap-12'>
        {AXES.map(({ title, description, Icon }) => (
          <li
            key={title}
            className='flex flex-col border-[var(--border)] border-l pl-8 text-[var(--text-muted)]'
          >
            <div className='flex flex-1 items-center justify-center py-10'>
              <Icon />
            </div>
            <h3 className='text-[18px] text-[var(--text-primary)]'>{title}</h3>
            <p className='mt-2 max-w-[300px] text-[15px] text-[var(--text-body)] leading-[1.5]'>
              {description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
