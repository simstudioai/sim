import { ObsidianIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ObsidianBlockDisplay = {
  type: 'obsidian',
  name: 'Obsidian',
  description: 'Interact with your Obsidian vault via the Local REST API',
  category: 'tools',
  bgColor: '#0F0F0F',
  icon: ObsidianIcon,
  longDescription:
    'Read, create, update, search, and delete notes in your Obsidian vault. Manage periodic notes, execute commands, and patch content at specific locations. Requires the Obsidian Local REST API plugin.',
  docsLink: 'https://docs.sim.ai/integrations/obsidian',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
