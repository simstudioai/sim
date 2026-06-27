import { TriggerDevIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TriggerDevBlockDisplay = {
  type: 'trigger_dev',
  name: 'Trigger.dev',
  description: 'Trigger tasks and manage runs and schedules',
  category: 'tools',
  bgColor: '#000000',
  icon: TriggerDevIcon,
  longDescription:
    'Integrate Trigger.dev into the workflow. Trigger and batch trigger background tasks, retrieve and control runs (cancel, replay, reschedule, tags, metadata, events, traces), manage cron schedules, environment variables, queues, deployments, and waitpoint tokens, and query run data with TRQL.',
  docsLink: 'https://docs.sim.ai/integrations/trigger_dev',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
