import { SentryIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SentryBlockDisplay = {
  type: 'sentry',
  name: 'Sentry',
  description: 'Manage Sentry issues, projects, events, and releases',
  category: 'tools',
  bgColor: '#362D59',
  icon: SentryIcon,
  longDescription:
    'Integrate Sentry into the workflow. Monitor issues, manage projects, track events, and coordinate releases across your applications.',
  docsLink: 'https://docs.sim.ai/integrations/sentry',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
