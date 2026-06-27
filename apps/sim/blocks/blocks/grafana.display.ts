import { GrafanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GrafanaBlockDisplay = {
  type: 'grafana',
  name: 'Grafana',
  description: 'Interact with Grafana dashboards, alerts, and annotations',
  category: 'tools',
  bgColor: '#F46800',
  icon: GrafanaIcon,
  longDescription:
    'Integrate Grafana into workflows. Manage dashboards, alerts, annotations, data sources, folders, and monitor health status.',
  docsLink: 'https://docs.sim.ai/integrations/grafana',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
