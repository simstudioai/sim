import { NotionIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const NotionBlockDisplay = {
  type: 'notion',
  name: 'Notion (Legacy)',
  description: 'Manage Notion pages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const NotionV2BlockDisplay = {
  type: 'notion_v2',
  name: 'Notion',
  description: 'Manage Notion pages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay
