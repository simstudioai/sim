import { RootlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RootlyBlockDisplay = {
  type: 'rootly',
  name: 'Rootly',
  description: 'Manage incidents, alerts, and on-call with Rootly',
  category: 'tools',
  bgColor: '#6C72C8',
  icon: RootlyIcon,
  iconColor: '#6C72C8',
  longDescription:
    'Integrate Rootly incident management into workflows. Create and manage incidents, alerts, services, severities, and retrospectives.',
  docsLink: 'https://docs.sim.ai/integrations/rootly',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
