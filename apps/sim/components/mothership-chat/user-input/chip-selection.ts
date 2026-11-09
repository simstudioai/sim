/**
 * Pure selection-snapping math for the mention-chip textarea, extracted from the
 * `onSelect` handler so it can be unit-tested in isolation from DOM I/O.
 *
 * A mention chip occupies a contiguous `[start, end)` span of the textarea
 * value. The UI treats each chip as atomic: a selection edge may never land
 * strictly inside a chip. This function maps an observed selection to the
 * nearest valid one.
 */

/** A half-open chip span `[start, end)` in textarea-value coordinates. */
export interface ChipBound {
  start: number
  end: number
}

/** A selection or caret as reported by `selectionStart`/`selectionEnd`. */
export interface Selection {
  start: number
  end: number
}

/**
 * Snaps a selection so no edge sits inside a chip.
 *
 * - **Collapsed caret inside a chip** → nearest chip edge.
 * - **Ranged selection** → each edge inside a chip snaps to a boundary without
 *   collapsing the range. A lone moved edge (keyboard extend/shrink, drag) snaps
 *   in its direction of travel — growing absorbs the chip, shrinking releases
 *   it; a fresh selection (double-click, select-all) expands outward. The two
 *   paths differ only for a shrinking edge, so the gesture inference is safe
 *   even when a fresh selection happens to share an edge with `prev`.
 *
 * @param sel - The observed selection.
 * @param prev - The previously observed selection, used to infer which edge moved.
 * @param startChip - The chip containing `sel.start`, if any.
 * @param endChip - The chip containing `sel.end`, if any.
 * @returns The snapped selection (equal to `sel` when no edge is inside a chip).
 */
export function snapSelectionToChips(
  sel: Selection,
  prev: Selection,
  startChip: ChipBound | undefined,
  endChip: ChipBound | undefined
): Selection {
  const { start, end } = sel

  if (start === end) {
    if (!startChip) return sel
    const nearest =
      start - startChip.start < startChip.end - start ? startChip.start : startChip.end
    return { start: nearest, end: nearest }
  }

  const singleEdgeMoved = (start !== prev.start) !== (end !== prev.end)

  let newStart = startChip
    ? singleEdgeMoved && start > prev.start
      ? startChip.end
      : startChip.start
    : start
  const newEnd = endChip ? (singleEdgeMoved && end < prev.end ? endChip.start : endChip.end) : end

  // A selection contained within a single chip snaps both edges; clamp so it
  // collapses to a caret rather than inverting.
  if (newStart > newEnd) newStart = newEnd

  return { start: newStart, end: newEnd }
}
