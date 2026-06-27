import { SalesforceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SalesforceBlockDisplay = {
  type: 'salesforce',
  name: 'Salesforce',
  description: 'Interact with Salesforce CRM',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: SalesforceIcon,
  longDescription:
    'Integrate Salesforce into your workflow. Manage accounts, contacts, leads, opportunities, cases, and tasks, run reports and SOQL queries, and manage org schema by creating custom fields and objects via the Tooling API.',
  docsLink: 'https://docs.sim.ai/integrations/salesforce',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
