'use client'

import type React from 'react'
import { Badge, Checkbox, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { RowExecutionMetadata } from '@/lib/table'
import { StatusBadge } from '@/app/workspace/[workspaceId]/logs/utils'
import type { SaveReason } from '../../../types'
import { storageToDisplay } from '../../../utils'
import type { DisplayColumn } from '../types'
import { InlineEditor } from './inline-editors'

interface CellContentProps {
  value: unknown
  exec?: RowExecutionMetadata
  column: DisplayColumn
  isEditing: boolean
  initialCharacter?: string | null
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
  workflowNameById?: Record<string, string>
  /**
   * Human-readable labels for unmet deps on this row+group, used to render a
   * "Waiting" pill when the cell hasn't run because something it depends on
   * is empty. `undefined` (or empty) means no waiting state.
   */
  waitingOnLabels?: string[]
}

/**
 * Renders the visible content of a single cell. Workflow-output cells follow
 * a status-state-machine (block error / value / running / waiting / cancelled
 * / dash); plain cells render the typed value. When `isEditing` is true the
 * `InlineEditor` overlay sits on top of the static content.
 */
export function CellContent({
  value,
  exec,
  column,
  isEditing,
  initialCharacter,
  onSave,
  onCancel,
  waitingOnLabels,
}: CellContentProps) {
  const isNull = value === null || value === undefined

  let displayContent: React.ReactNode = null
  if (column.workflowGroupId) {
    const blockId = column.outputBlockId
    const blockError = blockId ? exec?.blockErrors?.[blockId] : undefined
    const blockRunning = blockId ? (exec?.runningBlockIds?.includes(blockId) ?? false) : false
    const hasValue = !isNull
    const valueText =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : JSON.stringify(value)

    // Once any block in the group has reported an error, downstream cells
    // that haven't started won't run on this attempt — collapse them to dash
    // instead of leaving a stale "Waiting" spinner if the cell task didn't
    // reach a clean terminal state.
    const groupHasBlockErrors = !!(exec?.blockErrors && Object.keys(exec.blockErrors).length > 0)
    if (blockError) {
      displayContent = <StatusBadge status='error' />
    } else if (hasValue) {
      displayContent = (
        <span className='block overflow-clip text-ellipsis text-[var(--text-primary)]'>
          {valueText}
        </span>
      )
    } else if (
      (exec?.status === 'running' || exec?.status === 'queued' || exec?.status === 'pending') &&
      !(groupHasBlockErrors && !blockRunning)
    ) {
      // `pending` (pre-enqueue) and `queued` (post-enqueue, awaiting pickup)
      // both read as "in the queue, not actively running" — collapse into one
      // gray "Queued" badge so the user doesn't see a flicker as the row
      // transitions pending → queued. Active block execution flips to amber
      // "Running" via the logs StatusBadge.
      if (blockRunning) {
        displayContent = <StatusBadge status='running' />
      } else if (exec?.status === 'queued' || exec?.status === 'pending') {
        displayContent = (
          <Badge variant='gray' dot size='sm'>
            Queued
          </Badge>
        )
      } else {
        // `running` without this block in `runningBlockIds` = upstream block
        // still going. Show as Pending (amber) per logs convention.
        displayContent = <StatusBadge status='pending' />
      }
    } else if (exec?.status === 'cancelled') {
      displayContent = <StatusBadge status='cancelled' />
    } else if (exec?.status === 'error') {
      // Group-level failure (executor blew up, missing credentials, validation)
      // — no specific block produced the error so `blockErrors` is empty.
      displayContent = <StatusBadge status='error' />
    } else if (waitingOnLabels && waitingOnLabels.length > 0) {
      // The cell hasn't run because the group is waiting on at least one dep
      // (an empty input column or an unfinished upstream group). Tooltip names
      // the offenders so the user knows what to fill in.
      displayContent = (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span>
              <Badge variant='gray' dot size='sm'>
                Waiting
              </Badge>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            Waiting on {waitingOnLabels.map((l) => `"${l}"`).join(', ')}
          </Tooltip.Content>
        </Tooltip.Root>
      )
    } else {
      displayContent = <span className='text-[var(--text-tertiary)]'>—</span>
    }
    // Workflow-output cells are hand-editable: hide the status content under
    // the InlineEditor when the user opts to edit, then fall through to the
    // common return that renders the editor overlay.
    if (isEditing) {
      displayContent = <div className='invisible'>{displayContent}</div>
    }
  } else if (column.type === 'boolean') {
    displayContent = (
      <div
        className={cn('flex min-h-[20px] items-center justify-center', isEditing && 'invisible')}
      >
        <Checkbox size='sm' checked={Boolean(value)} className='pointer-events-none' />
      </div>
    )
  } else if (!isNull && column.type === 'json') {
    displayContent = (
      <span
        className={cn(
          'block overflow-clip text-ellipsis text-[var(--text-primary)]',
          isEditing && 'invisible'
        )}
      >
        {JSON.stringify(value)}
      </span>
    )
  } else if (!isNull && column.type === 'date') {
    displayContent = (
      <span className={cn('text-[var(--text-primary)]', isEditing && 'invisible')}>
        {storageToDisplay(String(value))}
      </span>
    )
  } else if (!isNull) {
    displayContent = (
      <span
        className={cn(
          'block overflow-clip text-ellipsis text-[var(--text-primary)]',
          isEditing && 'invisible'
        )}
      >
        {String(value)}
      </span>
    )
  }

  return (
    <>
      {isEditing && (
        <div className='absolute inset-0 z-10 flex items-start px-0'>
          <InlineEditor
            value={value}
            column={column}
            initialCharacter={initialCharacter ?? undefined}
            onSave={onSave}
            onCancel={onCancel}
          />
        </div>
      )}
      {displayContent}
    </>
  )
}
