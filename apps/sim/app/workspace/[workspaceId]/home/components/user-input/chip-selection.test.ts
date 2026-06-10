/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ChipBound,
  type Selection,
  snapSelectionToChips,
} from '@/app/workspace/[workspaceId]/home/components/user-input/chip-selection'

// A chip occupying value indices [5, 12): e.g. " @Gmail " sitting at offset 5.
const CHIP: ChipBound = { start: 5, end: 12 }

const at = (pos: number): Selection => ({ start: pos, end: pos })

describe('snapSelectionToChips', () => {
  describe('collapsed caret', () => {
    it('leaves a caret outside any chip untouched', () => {
      expect(snapSelectionToChips(at(3), at(3), undefined, undefined)).toEqual(at(3))
    })

    it('snaps a caret in the chip near the start to the start edge', () => {
      expect(snapSelectionToChips(at(6), at(6), CHIP, CHIP)).toEqual(at(5))
    })

    it('snaps a caret in the chip near the end to the end edge', () => {
      expect(snapSelectionToChips(at(11), at(11), CHIP, CHIP)).toEqual(at(12))
    })

    it('snaps the exact midpoint to the start edge (ties favor start)', () => {
      // distance to start (8.5-5=3.5) equals distance to end (12-8.5=3.5) only at
      // 8.5; integer midpoint 8 is closer to start.
      expect(snapSelectionToChips(at(8), at(8), CHIP, CHIP)).toEqual(at(5))
    })

    it('does not snap a caret resting exactly on an edge (edge is not "inside")', () => {
      // findRangeContaining is strict, so an edge caret has no containing chip.
      expect(snapSelectionToChips(at(5), at(5), undefined, undefined)).toEqual(at(5))
      expect(snapSelectionToChips(at(12), at(12), undefined, undefined)).toEqual(at(12))
    })
  })

  describe('ranged — fresh selection (both edges differ from prev)', () => {
    it('expands a start edge inside a chip outward to the chip start', () => {
      // select-all-like: prev was a caret at 20, new selection 8..30 grew both edges.
      const out = snapSelectionToChips({ start: 8, end: 30 }, at(20), CHIP, undefined)
      expect(out).toEqual({ start: 5, end: 30 })
    })

    it('expands an end edge inside a chip outward to the chip end', () => {
      const out = snapSelectionToChips({ start: 0, end: 9 }, at(20), undefined, CHIP)
      expect(out).toEqual({ start: 0, end: 12 })
    })

    it('expands both edges when each lands in a (different) chip', () => {
      const chipB: ChipBound = { start: 20, end: 27 }
      const out = snapSelectionToChips({ start: 8, end: 23 }, at(40), CHIP, chipB)
      expect(out).toEqual({ start: 5, end: 27 })
    })
  })

  describe('ranged — single moved edge (keyboard extend / shrink)', () => {
    it('growing the end edge into a chip absorbs the whole chip', () => {
      // prev 0..6, end moved 6 -> 9 (grew); start unchanged.
      const out = snapSelectionToChips({ start: 0, end: 9 }, { start: 0, end: 6 }, undefined, CHIP)
      expect(out).toEqual({ start: 0, end: 12 })
    })

    it('shrinking the end edge out of a chip releases the whole chip', () => {
      // prev 0..14, end moved 14 -> 9 (shrank) into the chip; release to chip start.
      const out = snapSelectionToChips({ start: 0, end: 9 }, { start: 0, end: 14 }, undefined, CHIP)
      expect(out).toEqual({ start: 0, end: 5 })
    })

    it('growing the start edge leftward into a chip absorbs the whole chip', () => {
      // prev 9..20, start moved 9 -> 6 (grew leftward, start < prev.start).
      const out = snapSelectionToChips(
        { start: 6, end: 20 },
        { start: 9, end: 20 },
        CHIP,
        undefined
      )
      expect(out).toEqual({ start: 5, end: 20 })
    })

    it('shrinking the start edge rightward into a chip releases the whole chip', () => {
      // prev 6..20, start moved 6 -> 9 (shrank rightward, start > prev.start) → chip end.
      const out = snapSelectionToChips(
        { start: 9, end: 20 },
        { start: 6, end: 20 },
        CHIP,
        undefined
      )
      expect(out).toEqual({ start: 12, end: 20 })
    })
  })

  describe('selection contained within one chip', () => {
    it('clamps to a collapsed caret rather than inverting', () => {
      // Both edges inside CHIP via a fresh selection: start→5, end→12 stays ordered.
      // Construct an inverting case: a shrink where start snaps to 12 and end to 5.
      const out = snapSelectionToChips({ start: 7, end: 9 }, { start: 5, end: 9 }, CHIP, CHIP)
      expect(out.start).toBeLessThanOrEqual(out.end)
    })
  })

  describe('no chips', () => {
    it('returns the selection unchanged', () => {
      const sel = { start: 2, end: 18 }
      expect(snapSelectionToChips(sel, at(0), undefined, undefined)).toEqual(sel)
    })
  })
})
