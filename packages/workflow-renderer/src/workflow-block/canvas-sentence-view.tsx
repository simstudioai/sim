import { Fragment, type ReactNode } from 'react'
import { OverflowSpan } from '../lib/overflow-span'
import { InlineChip } from './inline-chip'

/**
 * One piece of a resolved card summary: literal copy, or a slot whose subblock
 * value renders as an inline chip.
 *
 * `noun` marks the slot as core — it holds its place whether or not the field
 * is filled, showing the noun until it is. A slot without one is a detail the
 * user has not reached yet and drops until filled.
 *
 * Structurally identical to `ResolvedSentenceSegment` in the app's
 * `canvas-sentence` resolver; restated here because packages never import from
 * `apps/*`.
 */
export type CanvasSentenceSegment = string | { subBlockId: string; noun?: string }

export interface CanvasSentenceViewProps {
  segments: readonly CanvasSentenceSegment[]
  /**
   * Renders the value chip for a subblock, or `null` when it holds no value.
   *
   * Each surface hydrates differently — the editor resolves table and
   * credential names through React Query, the read-only preview has no hooks —
   * so the chip itself stays the caller's job. A `null` return is the empty
   * state, not a request to drop the segment: what happens next is decided
   * here, by whether the slot carries a `noun`.
   */
  renderChip: (subBlockId: string) => ReactNode
}

/**
 * Renders a block's summary sentence.
 *
 * Owns the spacing between segments, which is the part that silently drifts:
 * a chip is always preceded by a space, and literal copy is too *unless* it
 * opens with punctuation that must hug the preceding chip (`', where'`). Two
 * surfaces paint this sentence — the editor canvas and the read-only preview
 * behind logs, the deploy modal and the diff view — and a card that spaces its
 * clauses differently in one of them reads as a rendering bug.
 */
export function CanvasSentenceView({ segments, renderChip }: CanvasSentenceViewProps) {
  return (
    <p className='min-w-0 break-words text-[var(--text-muted)] text-sm leading-6'>
      {segments.map((segment, index) => {
        if (typeof segment === 'string') {
          const hugsPrevious = segment.startsWith(',') || segment.startsWith('.')
          const glue = index > 0 && !hugsPrevious ? ' ' : ''
          return <Fragment key={`text-${index}`}>{`${glue}${segment}`}</Fragment>
        }

        /* A core slot keeps its place with the field's noun; an optional one
           drops, so a configured card stays as short as what it actually says. */
        const value = renderChip(segment.subBlockId)
        const placeholder = segment.noun ? (
          <InlineChip muted>
            <OverflowSpan value={segment.noun} className='min-w-0' />
          </InlineChip>
        ) : null
        const chip = value || placeholder
        if (!chip) return null

        /* The space before `{chip}` is significant — JSX keeps whitespace
           between text and an expression on the same line. It is what
           separates a chip from the copy in front of it. */
        return <Fragment key={`value-${index}`}> {chip}</Fragment>
      })}
    </p>
  )
}
