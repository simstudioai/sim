import { NoteIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const NoteBlock: BlockConfig = {
  type: 'note',
  name: 'Note',
  description: 'Add contextual annotations directly onto the workflow canvas.',
  longDescription:
    'Use Note blocks to document decisions, share instructions, or leave context for collaborators directly on the workflow canvas. Notes support Markdown rendering and YouTube video embeds.',
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: NoteIcon,
  subBlocks: [
    {
      id: 'content',
      type: 'long-input',
      rows: 8,
      placeholder: 'Add context or instructions for collaborators...',
      description: 'Write your note using Markdown. YouTube links will display as embedded videos.',
    },
  ],
  tools: { access: [] },
  inputs: {
    content: {
      type: 'string',
      description: 'Markdown text for the note.',
    },
  },
  outputs: {},
}
