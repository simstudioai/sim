import type { ReactNode } from 'react'
import { ChevronRight } from '@sim/emcn/icons'

interface ReferenceDetailsProps {
  children: ReactNode
  label?: string
}

/** Keeps reference fields in the document for search and direct heading links. */
export function ReferenceDetails({
  children,
  label = 'Inputs and outputs',
}: ReferenceDetailsProps) {
  return (
    <details className='group/reference my-4 border-[var(--border)] border-b pb-3'>
      <summary className='flex min-h-10 pointer-coarse:min-h-11 cursor-pointer list-none items-center gap-2 rounded py-2 text-[var(--text-muted)] text-sm transition-colors hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden'>
        <ChevronRight aria-hidden className='size-[14px] shrink-0 group-open/reference:rotate-90' />
        {label}
      </summary>
      <div className='min-w-0 pb-2 [&>h4:first-child]:mt-3'>{children}</div>
    </details>
  )
}
