'use client'

import type React from 'react'
import { Checkbox } from '@/components/emcn'
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
      displayContent = (
        <span title={blockError}>
          <StatusBadge status='error' />
        </span>
      )
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
      // Treat queued / pending / waiting (running but this block hasn't
      // started) as a single "Pending" state — only the actively-executing
      // block flips to "Running".
      displayContent = <StatusBadge status={blockRunning ? 'running' : 'pending'} />
    } else if (exec?.status === 'cancelled') {
      displayContent = <StatusBadge status='cancelled' />
    } else if (exec?.status === 'error') {
      // Group-level failure (executor blew up, missing credentials, validation)
      // — no specific block produced the error so `blockErrors` is empty.
      // Surface the top-level error on every output cell in the group.
      displayContent = (
        <span title={exec.error ?? undefined}>
          <StatusBadge status='error' />
        </span>
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
