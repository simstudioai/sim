import type { ReactNode } from 'react'
import { ChipTag, cn } from '@sim/emcn'

/**
 * The chip box a summary sentence embeds a slot in.
 *
 * One definition for both states a slot has — the hydrated value, and the
 * field's noun standing in for it while the field is empty — so filling a field
 * changes the text inside the chip and never the chip's own geometry. Two
 * surfaces paint these (the editor canvas and the read-only preview), and a
 * slot that shifts as it fills reads as a rendering bug.
 */
export interface InlineChipProps {
  children: ReactNode
  /** Placeholder styling, for a slot showing its noun rather than a value. */
  muted?: boolean
}

export function InlineChip({ children, muted }: InlineChipProps) {
  return (
    <ChipTag
      variant='workflow-inline'
      className={cn(
        'max-w-[160px] translate-y-[-1px] align-middle',
        muted && 'text-[var(--text-muted)]'
      )}
    >
      {children}
    </ChipTag>
  )
}
