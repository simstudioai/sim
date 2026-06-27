import { EvernoteIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const EvernoteBlockDisplay = {
  type: 'evernote',
  name: 'Evernote',
  description: 'Manage notes, notebooks, and tags in Evernote',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: EvernoteIcon,
  longDescription:
    'Integrate with Evernote to manage notes, notebooks, and tags. Create, read, update, copy, search, and delete notes. Create and list notebooks and tags.',
  docsLink: 'https://docs.sim.ai/integrations/evernote',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
