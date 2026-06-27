import { NoteBlockDisplay } from '@/blocks/blocks/note.display'
import type { BlockConfig } from '@/blocks/types'

export const NoteBlock: BlockConfig = {
  ...NoteBlockDisplay,
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
