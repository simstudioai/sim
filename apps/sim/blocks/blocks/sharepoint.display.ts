import { MicrosoftSharepointIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SharepointBlockDisplay = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Work with pages and lists',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftSharepointIcon,
  longDescription:
    'Integrate SharePoint into the workflow. Read/create pages, list sites, and work with lists (read, create, update items). Requires OAuth.',
  docsLink: 'https://docs.sim.ai/integrations/sharepoint',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const SharepointV2BlockDisplay = {
  ...SharepointBlockDisplay,
  type: 'sharepoint_v2',
  name: 'SharePoint',
  hideFromToolbar: false,
} satisfies BlockDisplay
