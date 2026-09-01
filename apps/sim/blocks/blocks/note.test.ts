/**
 * @vitest-environment node
 */
import { DEFAULT_NOTE_COLOR, isNoteColor, NOTE_COLOR_OPTIONS } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import { NoteBlock } from '@/blocks/blocks/note'

function getSubBlock(id: string) {
  return NoteBlock.subBlocks.find((subBlock) => subBlock.id === id)
}

describe('note block', () => {
  it('seeds new notes with the same default the renderer paints', () => {
    /*
     * The registry default and the palette default are read by different
     * systems — the store materializes this value onto a new note, the canvas
     * resolves the swatch from the palette. A literal in either place drifts
     * silently: the note would persist one color and paint another.
     */
    expect(getSubBlock('color')?.defaultValue).toBe(DEFAULT_NOTE_COLOR)
    expect(isNoteColor(DEFAULT_NOTE_COLOR)).toBe(true)
  })

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

  it('offers a palette with stable, unique ids', () => {
    const ids = NOTE_COLOR_OPTIONS.map((option) => option.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_NOTE_COLOR)
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
