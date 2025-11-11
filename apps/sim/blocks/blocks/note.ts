import { NoteIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const NoteBlock: BlockConfig = {
  type: 'note',
  name: 'Note',
  description: 'Add contextual annotations directly onto the workflow canvas.',
  longDescription:
    'Use Note blocks to document decisions, share instructions, or leave context for collaborators directly on the workflow canvas. Notes support both plain text and Markdown rendering.',
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: NoteIcon,
  subBlocks: [
    {
      id: 'format',
      title: 'Display Format',
      type: 'dropdown',
      options: [
        { label: 'Plain text', id: 'plain' },
        { label: 'Markdown', id: 'markdown' },
      ],
      value: () => 'plain',
      description: 'Choose how the note should render on the canvas.',
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      rows: 8,
      placeholder: 'Add context or instructions for collaborators...',
      description: 'Write your note using plain text or Markdown depending on the selected format.',
    },
  ],
  tools: { access: [] },
  inputs: {
    format: {
      type: 'string',
      description: 'Render mode for the note content.',
    },
    content: {
      type: 'string',
      description: 'Text for the note.',
    },
  },
  outputs: {},
}
