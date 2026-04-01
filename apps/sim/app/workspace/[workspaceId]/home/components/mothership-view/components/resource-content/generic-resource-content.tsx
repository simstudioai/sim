'use client'

import { useEffect, useRef } from 'react'
import { PillsRing } from '@/components/emcn'
import type { GenericResourceData } from '@/app/workspace/[workspaceId]/home/types'

interface GenericResourceContentProps {
  data: GenericResourceData
}

// TODO: Emir — replace with rich UI (status icons, collapsible result cards, copy-to-clipboard, etc.)
export function GenericResourceContent({ data }: GenericResourceContentProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data.entries.length])

  if (data.entries.length === 0) {
    return (
      <div className='flex h-full items-center justify-center'>
        <p className='text-[13px] text-[var(--text-muted)]'>No results yet</p>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col divide-y divide-[var(--border)] overflow-y-auto [scrollbar-gutter:stable]'>
      {data.entries.map((entry) => (
        <div key={entry.toolCallId} className='flex flex-col gap-2 px-4 py-3'>
          <div className='flex items-center gap-2'>
            {entry.status === 'executing' && (
              <PillsRing
                className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
                animate
              />
            )}
            <span className='font-medium text-[13px] text-[var(--text-primary)]'>
              {entry.displayTitle}
            </span>
            {entry.status === 'error' && (
              <span className='ml-auto text-[12px] text-[var(--text-error)]'>Error</span>
            )}
          </div>
          {entry.streamingArgs && (
            <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-body)]'>
              {entry.streamingArgs}
            </pre>
          )}
          {!entry.streamingArgs && entry.result?.output != null && (
            <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-body)]'>
              {typeof entry.result.output === 'string'
                ? entry.result.output
                : JSON.stringify(entry.result.output, null, 2)}
            </pre>
          )}
          {entry.result?.error && (
            <p className='text-[12px] text-[var(--text-error)]'>{entry.result.error}</p>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
