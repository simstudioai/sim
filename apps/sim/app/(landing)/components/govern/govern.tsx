import { cn } from '@sim/emcn'
import { LANDING_TYPE } from '@/app/(landing)/components/landing-layout'
import { SectionBand } from '@/app/(landing)/components/section-band'
import {
  AccessControlGraphic,
  DeployGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'

/**
 * Governance section - the homepage's enterprise thesis.
 *
 * Structured as a visual index of the three control claims (permissions,
 * spend, distribution) over the same beats used in the previous pass: a
 * verb-led claim, one line, and three named capabilities. The graphics are
 * the existing enterprise vignettes - real product chrome, not new
 * illustration - so `/` and `/enterprise` stay visually consistent.
 *
 * One of the three visual stages is dark (distribution), per the page's
 * one-dark-tile-per-section rule. Self-hosting is not repeated here; it lives
 * in the security section.
 */

interface Capability {
  name: string
  definition: string
}

interface Beat {
  id: string
  title: string
  lead: string
  capabilities: readonly Capability[]
}

const BEATS: readonly Beat[] = [
  {
    id: 'permissions',
    title: 'Control what every team can touch.',
    lead: 'Permission groups in Sim decide which models, integrations, and tools a team can reach.',
    capabilities: [
      { name: 'Model access', definition: 'Allowlist the providers a group is allowed to call.' },
      {
        name: 'Integration access',
        definition: 'Choose which of the 1,000+ integrations they can connect.',
      },
      {
        name: 'Tool and surface limits',
        definition: 'Switch off MCP, custom tools, or whole product tabs.',
      },
    ],
  },
  {
    id: 'spend',
    title: 'Cap the spend before it happens.',
    lead: 'Set a monthly limit on the organization and on each member, then see where every credit went.',
    capabilities: [
      { name: 'Org and member limits', definition: 'A hard monthly ceiling, not an alert.' },
      { name: 'Usage analytics', definition: 'Spend broken out by workspace, member, and run.' },
      { name: 'Concurrency caps', definition: 'Bound how much runs at once, and for how long.' },
    ],
  },
  {
    id: 'distribution',
    title: 'Ship agents where your company already works.',
    lead: 'Deploy any agent as a chat interface, an API, or an MCP server - and decide who reaches it.',
    capabilities: [
      { name: 'Three surfaces', definition: 'Chat, API, or MCP, from the same agent.' },
      { name: 'Access gating', definition: 'Open it to SSO, a named email list, or a password.' },
      { name: 'Per-group rules', definition: 'Admins pick which surfaces a team may publish to.' },
    ],
  },
] as const

const STAGES = [
  { id: 'permissions', tone: 'light', graphic: <AccessControlGraphic /> },
  { id: 'spend', tone: 'light', graphic: <RunMonitoringGraphic /> },
  { id: 'distribution', tone: 'dark', graphic: <DeployGraphic /> },
] as const

export function Govern() {
  return (
    <SectionBand tone='static' id='govern' labelledBy='govern-heading'>
      <div className='flex w-full items-end justify-between gap-12 max-xl:flex-col max-xl:items-start max-xl:gap-6'>
        <h2
          id='govern-heading'
          className={cn('max-w-[20ch] text-balance text-[var(--text-primary)]', LANDING_TYPE.h2)}
        >
          Ship company-wide AI without losing control of it.
        </h2>
        <p
          className={cn(
            'w-[420px] flex-none text-pretty text-[var(--text-body)] max-xl:w-full',
            LANDING_TYPE.lead
          )}
        >
          Sim gives administrators the controls a company-wide rollout needs.
        </p>
      </div>

      <div className='mt-16 grid grid-cols-3 gap-5 max-sm:mt-10 max-lg:grid-cols-1'>
        {STAGES.map((stage) => (
          <div
            key={stage.id}
            aria-hidden='true'
            className={cn(
              'relative min-h-[300px] overflow-hidden rounded-[16px]',
              stage.tone === 'dark' ? 'bg-[var(--text-secondary)]' : 'bg-[var(--surface-2)]'
            )}
          >
            {stage.graphic}
          </div>
        ))}
      </div>

      <div className='mt-20 flex flex-col max-sm:mt-12 max-lg:mt-16'>
        {BEATS.map((beat, index) => (
          <div
            key={beat.id}
            className={cn(
              'grid grid-cols-[420px_1fr] gap-12 border-[var(--surface-7)] border-t py-14',
              'max-sm:py-8 max-lg:grid-cols-1 max-lg:gap-8 max-lg:py-10',
              index === 0 && 'border-t-0 pt-0'
            )}
          >
            <div className='flex flex-col gap-4'>
              <h3 className={cn('text-balance text-[var(--text-primary)]', LANDING_TYPE.h3)}>
                {beat.title}
              </h3>
              <p
                className={cn(
                  'max-w-[40ch] text-pretty text-[var(--text-body)]',
                  LANDING_TYPE.body
                )}
              >
                {beat.lead}
              </p>
            </div>

            <ul className='grid grid-cols-3 gap-8 max-sm:grid-cols-1 max-sm:gap-6 max-lg:gap-6'>
              {beat.capabilities.map((capability) => (
                <li
                  key={capability.name}
                  className='flex flex-col gap-2 border-[var(--surface-7)] border-t pt-4'
                >
                  <h4 className={cn('text-[var(--text-primary)]', LANDING_TYPE.meta)}>
                    {capability.name}
                  </h4>
                  <p className={cn('text-pretty text-[var(--text-secondary)]', LANDING_TYPE.body)}>
                    {capability.definition}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionBand>
  )
}
