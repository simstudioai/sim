import type { ReactNode } from 'react'
import { ChevronRight } from '@sim/emcn/icons'

interface ReferenceDetailsProps {
  children: ReactNode
  label?: string
  open?: boolean
}

/** Native details retain full fields for browser find and direct heading links. */
export function ReferenceDetails({
  children,
  label = 'Inputs and outputs',
  open,
}: ReferenceDetailsProps) {
  return (
    <details open={open} className='my-4 min-w-0 [&[open]>summary>svg]:rotate-90'>
      <summary className='flex min-h-[38px] pointer-coarse:min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg py-2 text-[var(--docs-text)] text-docs-table transition-colors hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden'>
        <ChevronRight className='size-4 shrink-0 text-[var(--docs-muted)] transition-transform motion-reduce:transition-none' />
        {label}
      </summary>
      <div className='min-w-0 pt-1 pb-3 pl-6 [&>:first-child]:mt-0 [&>:last-child]:mb-0'>
        {children}
      </div>
    </details>
  )
}
