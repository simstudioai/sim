import { AzureIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AzureDevOpsBlockDisplay = {
  type: 'azure_devops',
  name: 'Azure DevOps',
  description: 'Interact with Azure DevOps pipelines, builds, and work items',
  category: 'tools',
  bgColor: '#0078D4',
  icon: AzureIcon,
  longDescription:
    'Integrate Azure DevOps into your workflow. List and inspect pipelines and builds, query and manage work items, and add or read comments.',
  docsLink: 'https://docs.sim.ai/integrations/azure_devops',
  integrationType: IntegrationType.DevOps,
  triggerAllowed: true,
} satisfies BlockDisplay
