import { DatadogIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DatadogBlockDisplay = {
  type: 'datadog',
  name: 'Datadog',
  description: 'Monitor infrastructure, applications, and logs with Datadog',
  category: 'tools',
  bgColor: '#632CA6',
  icon: DatadogIcon,
  iconColor: '#632CA6',
  longDescription:
    'Integrate Datadog monitoring into workflows. Submit metrics, manage monitors, query logs, create events, handle downtimes, and more.',
  docsLink: 'https://docs.sim.ai/integrations/datadog',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
