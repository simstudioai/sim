import { NoteIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const NoteBlockDisplay = {
  type: 'note',
  name: 'Note',
  description: 'Add contextual annotations directly onto the workflow canvas.',
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: NoteIcon,
  longDescription:
    'Use Note blocks to document decisions, share instructions, or leave context for collaborators directly on the workflow canvas. Notes support Markdown rendering and YouTube video embeds.',
} satisfies BlockDisplay
