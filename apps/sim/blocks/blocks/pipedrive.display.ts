import { PipedriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PipedriveBlockDisplay = {
  type: 'pipedrive',
  name: 'Pipedrive',
  description: 'Interact with Pipedrive CRM',
  category: 'tools',
  bgColor: '#2E6936',
  icon: PipedriveIcon,
  iconColor: '#26A65B',
  longDescription:
    'Integrate Pipedrive into your workflow. Manage deals, contacts, sales pipeline, projects, activities, files, and communications with powerful CRM capabilities.',
  docsLink: 'https://docs.sim.ai/integrations/pipedrive',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
