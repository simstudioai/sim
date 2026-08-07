/**
 * @vitest-environment node
 */
import { NOTE_MARKDOWN_FLOW } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import { NOTE_EDITOR_PROSE_CLASS_NAME } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-markdown-editor'

describe('note editor typography parity', () => {
  it('mirrors every block-rhythm rule the read view paints', () => {
    /*
     * The read view renders through Streamdown, whose wrapper carries this
     * rhythm and outranks the per-element margins; the editor renders through
     * ProseMirror, which has no such wrapper. When the two disagree, clicking
     * into a note visibly shifts every block after the first — the failure this
     * pins. Tailwind's JIT only sees literal strings, so the editor cannot
     * compose its variants from the constant; this asserts the mirror instead.
     */
    for (const rule of NOTE_MARKDOWN_FLOW.split(' ')) {
      const mirrored = rule.startsWith('[&>')
        ? `[&_.ProseMirror>${rule.slice('[&>'.length)}`
        : `[&_.ProseMirror]:${rule}`
      expect(NOTE_EDITOR_PROSE_CLASS_NAME).toContain(mirrored)
    }
  })
})
