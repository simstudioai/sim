import { JiraIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const JiraBlockDisplay = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: JiraIcon,
  longDescription:
    'Integrate Jira into the workflow. Can read, write, and update issues. Can also trigger workflows based on Jira webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/jira',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay
