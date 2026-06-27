import { IncidentioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const IncidentioBlockDisplay = {
  type: 'incidentio',
  name: 'incident.io',
  description: 'Manage incidents with incident.io',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: IncidentioIcon,
  longDescription:
    'Integrate incident.io into the workflow. Manage incidents, actions, follow-ups, workflows, schedules, escalations, custom fields, and more.',
  docsLink: 'https://docs.sim.ai/integrations/incidentio',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
