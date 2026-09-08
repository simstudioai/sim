import type { ReactNode } from 'react'
import type { FactSource } from '@/lib/compare/data'
import { SourcePopover } from '@/app/(landing)/comparisons/components/source-info/source-popover'

interface CitedContentProps {
  children: ReactNode
  sources: FactSource[]
  label: string
  tone?: 'default' | 'inverse'
}

/** Gives comparison copy the same per-item citation control as table cells. */
export function CitedContent({ children, sources, label, tone = 'default' }: CitedContentProps) {
  if (sources.length === 0) return children

  return (
    <>
      <SourcePopover sources={sources} label={label} tone={tone}>
        {children}
      </SourcePopover>
      <span className='sr-only'>
        {sources.map((source) => (
          <span key={source.url}>
            {' '}
            Source: {source.label}. {source.url}. Verified {source.asOf}.
          </span>
        ))}
      </span>
    </>
  )
}
