import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

interface InfoNoteProps {
  children: ReactNode
}

/**
 * Inline informational note for ee settings pages — a bordered, filled bar
 * with a leading info icon and muted caption text.
 */
export function InfoNote({ children }: InfoNoteProps) {
  return (
    <div
      role='note'
      className='flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[var(--text-muted)] text-caption'
    >
      <Info className='size-[14px] shrink-0' />
      <span>{children}</span>
    </div>
  )
}
