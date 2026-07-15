import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  RunMonitoringGraphic,
  StagingGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import {
  FailureAlertGraphic,
  FilterRunsGraphic,
  RunTraceGraphic,
} from '@/app/(landing)/logs/components/feature-graphics'
import { LogsHeroLoop } from '@/app/(landing)/logs/components/logs-hero-loop'

/**
 * Logs platform page - a consumer of {@link SolutionsPage} rendered with
 * the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout chrome: identity (for structured data), a
 * hero carrying the live Logs table loop, and two rows of three feature
 * tiles. Where the workflows page's "Trace every run" card introduces run
 * tracing in passing, this page goes deeper on the same story: the trace
 * itself (a new block-by-block waterfall vignette), live run details, the
 * run record, search and filters, failure debugging (the staging surface
 * retold as a failed run's snapshot), and alerting (a new failed-run →
 * Slack-alert vignette).
 *
 * The JSON-LD emitted by {@link SolutionsPage} is structurally identical
 * to the platform page's (`WebPage` + `BreadcrumbList` +
 * `WebApplication`), so the feature-tile treatment is SEO-neutral.
 */
const LOGS_CONFIG: SolutionsPageConfig = {
  module: 'Logs',
  path: '/logs',
  hero: {
    eyebrow: 'Logs',
    heading: 'Trace every agent decision, block by block, in Sim.',
    description:
      'Logs give teams full visibility into every run in Sim, the open-source AI workspace. Follow each agent run block by block, filter and search across every run, and catch failures the moment they happen.',
    summary:
      'Logs is the visibility layer in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Sim records every agent run block by block, so teams trace each decision, tool call, and output, filter and search across every run, and catch failures with alerts.',
    visual: (
      <PlatformHeroVisual>
        <LogsHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'trace',
      title: 'See exactly what every agent did.',
      subtitle:
        'Sim records every agent run block by block, so teams can follow each decision, tool call, and output on one timeline.',
      cta: { label: 'Explore Logs in Sim', href: '/signup' },
      cards: [
        {
          title: 'Trace runs block by block',
          description:
            'Sim captures every step of a run, each block, tool call, and model response with its duration, so no agent decision is a black box.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <RunTraceGraphic />,
        },
        {
          title: 'Watch runs as they happen',
          description:
            'Sim shows each run the moment it starts, with its trigger, duration, and output, so teams see agents working in real time.',
          visual: (
            <RunMonitoringGraphic
              fields={[
                { label: 'Workflow', value: 'Support ticket routing', variant: 'strong' },
                { label: 'Status', value: 'Completed', variant: 'chip' },
                { label: 'Latency', value: '1.86s', variant: 'mono' },
                { label: 'Tokens', value: '8.4K', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'status', value: '"completed"' },
                { key: 'tokens', value: '8412' },
              ]}
            />
          ),
        },
        {
          title: 'Every run on the record',
          description:
            'Sim keeps a permanent history of every run and follow-up, so teams can answer what happened, when, and who resolved it.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Error resolved',
                  actor: 'Maya Chen',
                  resource: 'Nightly data sync',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Run traced',
                  actor: 'Jordan Lee',
                  resource: 'Invoice matching · run 8f2a',
                  time: '12 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Logs exported',
                  actor: 'Sam Ortiz',
                  resource: 'June runs · CSV',
                  time: '1h ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Alert acknowledged',
                  actor: 'Maya Chen',
                  resource: 'Churn-risk alerts',
                  time: 'Jul 8',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
      ],
    },
    {
      id: 'catch',
      title: 'Catch failures before they spread.',
      subtitle:
        'Sim surfaces failed runs the moment they happen, with the alerts and context teams need to fix them fast.',
      cta: { label: 'Start tracing runs', href: '/signup' },
      cards: [
        {
          title: 'Filter to the runs that matter',
          description:
            'Search and filter every run in Sim by workflow, status, trigger, and time, so one failure is never buried under a thousand successes.',
          visual: <FilterRunsGraphic />,
        },
        {
          title: 'Debug with full context',
          description:
            'Sim snapshots each run, so teams open a failed run with its inputs, outputs, and trace intact and see exactly which block broke.',
          visual: (
            <StagingGraphic
              title='Nightly data sync'
              headerTag='run 8f2a'
              changeTag='error'
              changeTitle='Timeout in Post to ledger'
              attribution='Maya Chen · reviewing now'
              checks={['Inputs captured', 'Output snapshot saved', 'Trace preserved']}
              fromLabel='Error'
              toLabel='Resolved'
              actionLabel='Review run'
            />
          ),
        },
        {
          title: 'Catch failures with alerting',
          description:
            'When a run fails, Sim alerts the channel your team already watches, naming the failing block and linking straight to the trace.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <FailureAlertGraphic />,
        },
      ],
    },
  ],
}

export default function Logs() {
  return <SolutionsPage config={LOGS_CONFIG} />
}
