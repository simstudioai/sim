import { ServiceNowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ServiceNowBlockDisplay = {
  type: 'servicenow',
  name: 'ServiceNow',
  description: 'Create, read, update, and delete ServiceNow records',
  category: 'tools',
  bgColor: '#032D42',
  icon: ServiceNowIcon,
  longDescription:
    'Integrate ServiceNow into your workflow. Create, read, update, and delete records in any ServiceNow table including incidents, tasks, change requests, users, and more.',
  docsLink: 'https://docs.sim.ai/integrations/servicenow',
  integrationType: IntegrationType.Support,
} satisfies BlockDisplay
