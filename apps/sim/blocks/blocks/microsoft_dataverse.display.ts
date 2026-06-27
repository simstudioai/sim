import { MicrosoftDataverseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MicrosoftDataverseBlockDisplay = {
  type: 'microsoft_dataverse',
  name: 'Microsoft Dataverse',
  description: 'Manage records in Microsoft Dataverse tables',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftDataverseIcon,
  longDescription:
    'Integrate Microsoft Dataverse into your workflow. Create, read, update, delete, upsert, associate, query, search, and execute actions and functions against Dataverse tables using the Web API. Supports bulk operations, FetchXML, file uploads, and relevance search. Works with Dynamics 365, Power Platform, and custom Dataverse environments.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_dataverse',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
