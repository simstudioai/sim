import { cn } from '@sim/emcn'
import { CoreFeatureCard } from '@/app/(landing)/components/features/components/core-feature-card'
import { FeaturesRail } from '@/app/(landing)/components/features/components/features-rail'
import {
  HOME_INSET,
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { CliGraphic } from '@/app/(landing)/components/shared/cli-graphic/cli-graphic'
import { FileLibraryGraphic } from '@/app/(landing)/files/components/feature-graphics/file-library-graphic'
import { ConnectorSyncGraphic } from '@/app/(landing)/knowledge/components/feature-graphics/connector-sync-graphic'
import { RunTraceGraphic } from '@/app/(landing)/logs/components/feature-graphics'
import { TableGridGraphic } from '@/app/(landing)/tables/components/feature-graphics'
import { WorkflowCanvasGraphic } from '@/app/(landing)/workflows/components/feature-graphics'

/**
 * Homepage product suite - six tall editorial modules built from the same
 * product-faithful UI illustrations used across Sim's platform pages.
 */
const CORE_FEATURES = [
  {
    title: 'CLI',
    description: 'Use Sim from Claude Code or your terminal to build, run, and manage agents.',
    href: 'https://docs.sim.ai/cli',
    tone: 'mid',
    visual: <CliGraphic />,
  },
  {
    title: 'Workflows',
    description: 'Sim connects blocks, models, and integrations into agent logic.',
    href: '/workflows',
    tone: 'light',
    visual: <WorkflowCanvasGraphic />,
  },
  {
    title: 'Knowledge Base',
    description: 'Sim gives every agent trusted memory from synced sources.',
    href: '/knowledge',
    tone: 'mid',
    visual: <ConnectorSyncGraphic />,
  },
  {
    title: 'Tables',
    description: 'Sim stores the structured data agents read and update between runs.',
    href: '/tables',
    tone: 'light',
    visual: <TableGridGraphic />,
  },
  {
    title: 'Files',
    description: 'Sim keeps team uploads and agent outputs in one shared store.',
    href: '/files',
    tone: 'mid',
    visual: <FileLibraryGraphic />,
  },
  {
    title: 'Logs',
    description: 'Sim traces every agent run block by block, including failures.',
    href: '/logs',
    tone: 'light',
    visual: <RunTraceGraphic />,
  },
] as const

/**
 * Six product modules on one horizontally scrolling rail. The heading keeps
 * the page measure; the rail runs flush to the screen edges and loops - see
 * {@link FeaturesRail}. The section is the rail's size container.
 */
export function Features() {
  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='flex flex-col [container-type:inline-size]'
    >
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className={HOME_INSET}>
          <h2
            id='features-heading'
            className={cn(
              'mb-16 max-w-[20ch] text-balance text-[var(--text-primary)] max-sm:mb-10 max-lg:mb-12',
              HOME_TYPE.h2
            )}
          >
            Everything AI agents need to do real work
          </h2>

          <FeaturesRail label='Core Sim features'>
            {CORE_FEATURES.map((feature) => (
              <CoreFeatureCard key={feature.title} {...feature} />
            ))}
          </FeaturesRail>
        </div>
      </div>
    </section>
  )
}
