import { JiraServiceManagementIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const JiraServiceManagementBlockDisplay = {
  type: 'jira_service_management',
  name: 'Jira Service Management',
  description: 'Interact with Jira Service Management',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: JiraServiceManagementIcon,
  longDescription:
    'Integrate with Jira Service Management for IT service management. Create and manage service requests, handle customers and organizations, track SLAs, and manage queues.',
  docsLink: 'https://docs.sim.ai/integrations/jira_service_management',
  integrationType: IntegrationType.Support,
} satisfies BlockDisplay
