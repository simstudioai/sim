'use client'

import { memo, useCallback } from 'react'
import { Clock, RotateCcw, Trash2 } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import type { WorkflowSnapshot } from '@/stores/workflow-history'
import { useWorkflowHistoryStore } from '@/stores/workflow-history'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Formats a timestamp as a relative time ("2m ago") or absolute time for older entries.
 */
function formatTime(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  // For older entries, show date
  return new Date(isoTimestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface WorkflowHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Popover showing browser-local workflow change history.
 * Each entry is a full state snapshot captured automatically when the user
 * modifies the workflow. Clicking an entry restores the workflow to that state.
 *
 * History persists across page reloads via localStorage.
 */
export const WorkflowHistory = memo(function WorkflowHistory({
  open,
  onOpenChange,
}: WorkflowHistoryProps) {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const snapshots = useWorkflowHistoryStore((state) =>
    activeWorkflowId ? state.getSnapshots(activeWorkflowId) : []
  )
  const restoreSnapshot = useWorkflowHistoryStore((state) => state.restoreSnapshot)
  const clearHistory = useWorkflowHistoryStore((state) => state.clearHistory)

  const handleRestore = useCallback(
    (snapshot: WorkflowSnapshot) => {
      if (!activeWorkflowId) return
      restoreSnapshot(activeWorkflowId, snapshot.id)
      onOpenChange(false)
    },
    [activeWorkflowId, restoreSnapshot, onOpenChange]
  )

  const handleClear = useCallback(() => {
    if (!activeWorkflowId) return
    clearHistory(activeWorkflowId)
  }, [activeWorkflowId, clearHistory])

  return (
    <Popover open={open} onOpenChange={onOpenChange} size='sm'>
      <PopoverTrigger asChild>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              className='h-[28px] w-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
              variant={open ? 'active' : 'ghost'}
              aria-label='Change history'
            >
              <Clock className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          {!open && <Tooltip.Content side='right'>Change history</Tooltip.Content>}
        </Tooltip.Root>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='right'
        sideOffset={8}
        style={{ minWidth: '220px', maxWidth: '280px' }}
      >
        {snapshots.length === 0 ? (
          <div className='flex flex-col items-center gap-1.5 px-2 py-6'>
            <Clock className='h-5 w-5 text-[var(--text-muted)]' />
            <span className='text-center text-[12px] text-[var(--text-muted)]'>No changes yet</span>
            <span className='text-center text-[11px] text-[var(--text-subtle)]'>
              History is saved automatically as you edit
            </span>
          </div>
        ) : (
          <>
            <PopoverScrollArea>
              <PopoverSection>Recent Changes</PopoverSection>
              {snapshots.map((snapshot) => (
                <PopoverItem key={snapshot.id} onClick={() => handleRestore(snapshot)}>
                  <RotateCcw className='h-3 w-3 flex-shrink-0 text-[var(--text-muted)]' />
                  <span className='flex-1 truncate text-[12px]'>{snapshot.label}</span>
                  <span className='flex-shrink-0 text-[10px] text-[var(--text-muted)]'>
                    {formatTime(snapshot.timestamp)}
                  </span>
                </PopoverItem>
              ))}
            </PopoverScrollArea>

            <div className='border-t border-[var(--border)] pt-1'>
              <PopoverItem onClick={handleClear}>
                <Trash2 className='h-3 w-3 flex-shrink-0 text-[var(--text-muted)]' />
                <span className='text-[12px]'>Clear history</span>
              </PopoverItem>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
})
