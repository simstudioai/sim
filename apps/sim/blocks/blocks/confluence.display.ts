import { ConfluenceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ConfluenceBlockDisplay = {
  type: 'confluence',
  name: 'Confluence (Legacy)',
  description: 'Interact with Confluence',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ConfluenceIcon,
  longDescription:
    'Integrate Confluence into the workflow. Can read, create, update, delete pages, manage comments, attachments, labels, and search content.',
  docsLink: 'https://docs.sim.ai/integrations/confluence',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ConfluenceV2BlockDisplay = {
  ...ConfluenceBlockDisplay,
  type: 'confluence_v2',
  name: 'Confluence',
  hideFromToolbar: false,
} satisfies BlockDisplay
