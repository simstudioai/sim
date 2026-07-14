import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  DeployGraphic,
  ItPlatformTeamsGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { ScheduledTasksHeroLoop } from '@/app/(landing)/scheduled-tasks/components/scheduled-tasks-hero-loop'
import { DocumentDraftGraphic } from '@/app/(landing)/solutions/components/feature-graphics'

/**
 * Scheduled Tasks platform page - a consumer of {@link SolutionsPage}
 * rendered with the enterprise page's feature-tile treatment.
 *
 * The page tells the product's real scheduling story: workflows carry
 * schedule triggers (from every-15-minutes intervals through daily, weekly,
 * and monthly cadences to custom cron, timezone-aware), and the workspace's
 * Scheduled Tasks calendar shows every upcoming and finished run with
 * pause/resume and full run history. Every visual slot reuses a
 * parametrized enterprise feature graphic retold for recurring runs - the
 * policy checklist as a schedule card, the routing fan as the delivery
 * fan-out, the drafted document as the digest that arrives on time, the
 * monitoring panel, deploy window, and audit ledger for the operate story.
 *
 * The JSON-LD emitted by {@link SolutionsPage} is structurally identical to
 * the workflows page's (`WebPage` + `BreadcrumbList` + `WebApplication`).
 */
const SCHEDULED_TASKS_CONFIG: SolutionsPageConfig = {
  module: 'Scheduled Tasks',
  path: '/scheduled-tasks',
  hero: {
    eyebrow: 'Scheduled Tasks',
    heading: 'Set agents to run on a schedule, and let the work happen on its own.',
    description:
      'Scheduled Tasks runs your agents on a cadence in Sim, the open-source AI workspace. Pick a time from every 15 minutes to monthly or write a cron, timezone-aware, with every run traced.',
    summary:
      'Scheduled Tasks is the scheduler in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Put any workflow on a cadence, from 15-minute intervals to daily, weekly, and monthly runs or custom cron, timezone-aware, then watch every scheduled run land on the workspace calendar with full run history.',
    visual: (
      <PlatformHeroVisual>
        <ScheduledTasksHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'schedule',
      title: 'Put any agent on a cadence.',
      subtitle:
        'Sim turns a workflow into a scheduled task with one trigger, from 15-minute intervals to monthly closes, in your timezone.',
      cta: { label: 'Schedule your first agent', href: '/signup' },
      cards: [
        {
          title: 'Pick the cadence',
          description:
            'Choose minutes, hourly, daily, weekly, or monthly, or write a cron expression for exact control.',
          visual: (
            <ItPlatformTeamsGraphic
              title='Schedule'
              badgeLabel='Recurring'
              cardTitle='Morning digest'
              cardSubtitle='Weekdays at 9:00 AM'
              cardTag='Active'
              controls={[
                { label: 'Timezone', detail: 'US Pacific' },
                { label: 'Custom cron', detail: 'Supported' },
                { label: 'Pause anytime', detail: 'One click' },
              ]}
            />
          ),
        },
        {
          title: 'Fan out on every run',
          description:
            'Each run pulls from your systems and delivers wherever the work lives, without anyone pressing go.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Gmail', 'Stripe', 'Linear']}
              destinationLabels={['Slack', 'Email', 'Sheets']}
            />
          ),
        },
        {
          title: 'Wake up to the output',
          description:
            'The digest, report, or sync is done before the day starts. Sim delivers it where your team looks first.',
          visual: (
            <DocumentDraftGraphic
              title='Monday digest'
              statusTag='On schedule'
              footerLabel='Delivered to #ops'
              footerDetail='9:00 AM'
            />
          ),
        },
      ],
    },
    {
      id: 'operate',
      title: 'Stay on top of every run.',
      subtitle:
        'Scheduled runs land on the workspace calendar, and Sim keeps the full history so nothing happens silently.',
      cta: { label: 'See runs in action', href: '/signup' },
      cards: [
        {
          title: 'Trace each scheduled run',
          description:
            'Every run is logged block by block, with the trigger, duration, and output a click away.',
          visual: (
            <RunMonitoringGraphic
              fields={[
                { label: 'Workflow', value: 'Morning digest', variant: 'strong' },
                { label: 'Run ID', value: 'a7c93e41', variant: 'chip' },
                { label: 'Trigger', value: 'Schedule', variant: 'chip' },
                { label: 'Duration', value: '3.4s', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'delivered', value: 'true' },
                { key: 'items', value: '12' },
              ]}
            />
          ),
        },
        {
          title: 'Keep it running',
          description:
            'Schedules stay live in production. Pause, resume, or retune the cadence without redeploying.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <DeployGraphic
              agentName='Digest agent'
              versionTag='v8'
              url='sim.ai/agents/digest'
              statusLabel='On schedule · live'
              timeLabel='Next run 9:00 AM'
            />
          ),
        },
        {
          title: 'Keep the history',
          description:
            'Every run and every schedule change lands in one record, so teams see what ran and when.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Run completed',
                  actor: 'Morning digest',
                  resource: '12 items delivered',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Schedule updated',
                  actor: 'Maya Chen',
                  resource: 'Weekdays · 9:00 AM',
                  time: '2h ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Sync completed',
                  actor: 'Nightly data sync',
                  resource: '4,120 rows',
                  time: '1d ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Schedule created',
                  actor: 'Jordan Lee',
                  resource: 'Morning digest',
                  time: 'Jun 2',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function ScheduledTasks() {
  return <SolutionsPage config={SCHEDULED_TASKS_CONFIG} cardVariant='featureTile' />
}
