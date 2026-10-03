import { DEFAULT_NOTE_COLOR } from '@sim/workflow-renderer/note-colors'
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
      searchTextFormat: 'markdown',
      rows: 8,
      placeholder: 'Add context or instructions for collaborators...',
      description: 'Write your note using Markdown. YouTube links will display as embedded videos.',
    },
    {
      /**
       * Declared here so workflow sanitization keeps it: the realtime server
       * writes `type: 'unknown'` for ids absent from the stored map, and
       * `lib/workflows/sanitization/subblocks.ts` drops unknown entries the
       * block registry does not declare. Removing this entry would silently
       * discard every user-chosen note color on the next load.
       */
      id: 'color',
      type: 'short-input',
      defaultValue: DEFAULT_NOTE_COLOR,
      hidden: true,
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
