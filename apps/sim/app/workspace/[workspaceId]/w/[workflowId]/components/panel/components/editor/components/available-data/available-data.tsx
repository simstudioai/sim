'use client'

import { Button, cn } from '@sim/emcn'
import { ChevronDown, Database } from '@sim/emcn/icons'
import { ConnectionBlocks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/connection-blocks'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'

interface AvailableDataProps {
  connections: ConnectedBlock[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Compact entry point for browsing and inserting upstream workflow output references. */
export function AvailableData({ connections, open, onOpenChange }: AvailableDataProps) {
  if (connections.length === 0) return null

  return (
    <div className='flex flex-shrink-0 flex-col border-[var(--border)] border-t bg-[var(--bg)]'>
      <Button
        type='button'
        variant='ghost'
        className='h-9 w-full justify-start rounded-none px-4 hover-hover:bg-[var(--surface-3)]'
        aria-expanded={open}
        aria-controls='available-data-sources'
        onClick={() => onOpenChange(!open)}
      >
        <Database className='size-[14px] text-[var(--text-icon)]' />
        <span className='font-medium text-[var(--text-primary)] text-small'>Available data</span>
        <span className='ml-0.5 text-[var(--text-muted)] text-small'>
          · {connections.length} {connections.length === 1 ? 'source' : 'sources'}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto size-[14px] text-[var(--text-icon)] transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </Button>
      {open && (
        <div id='available-data-sources' className='border-[var(--border)] border-t'>
          <ConnectionBlocks connections={connections} />
        </div>
      )}
    </div>
  )
}
