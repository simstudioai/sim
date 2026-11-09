import type { ReactNode } from 'react'
import { ChipTag } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/chip-tag'

/**
 * The chip box a summary sentence embeds a slot in.
 *
 * One definition for both states a slot has — the hydrated value, and the
 * field's noun standing in for it while the field is empty — so filling a field
 * changes the text inside the chip and never the chip's own geometry. Two
 * surfaces paint these (the editor canvas and the read-only preview), and a
 * slot that shifts as it fills reads as a rendering bug.
 */
interface InlineChipProps {
  children: ReactNode
  /** Placeholder styling, for a slot showing its noun rather than a value. */
  muted?: boolean
}

/** A sentence slot's value chip: the `mono` tag on the card surface with a hairline inset ring. */
export function InlineChip({ children, muted }: InlineChipProps) {
  return (
    <ChipTag paint={{ variant: 'mono' }} layout='inline' muted={muted}>
      {children}
    </ChipTag>
  )
}
