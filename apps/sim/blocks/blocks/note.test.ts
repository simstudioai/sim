import { DEFAULT_NOTE_COLOR, isNoteColor } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import { NoteBlock } from '@/blocks/blocks/note'

function getSubBlock(id: string) {
  return NoteBlock.subBlocks.find((subBlock) => subBlock.id === id)
}

describe('note block', () => {
  it('declares color so sanitization keeps a user-chosen value', () => {
    /*
     * The realtime server stores `type: 'unknown'` for ids the block config
     * does not declare, and `lib/workflows/sanitization/subblocks.ts` drops
     * those. Without this entry every chosen note color is discarded on the
     * next load, with nothing else in the pipeline to notice.
     */
    expect(getSubBlock('color')).toBeDefined()
    expect(getSubBlock('color')?.hidden).toBe(true)
  })

  it('rejects inherited object keys as note colors', () => {
    /*
     * The stored color survives sanitization by design, so it reaches the
     * renderer from imports, copilot edits and the realtime socket without
     * passing through the picker. A membership check that walked the prototype
     * chain would accept these and resolve to an inherited function, painting
     * the note with every style field undefined.
     */
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(isNoteColor(key)).toBe(false)
    }
    expect(isNoteColor(DEFAULT_NOTE_COLOR)).toBe(true)
  })
})
