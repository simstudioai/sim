'use client'

import type React from 'react'
import { Badge, Checkbox, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { RowExecutionMetadata } from '@/lib/table'
import { StatusBadge } from '@/app/workspace/[workspaceId]/logs/utils'
import { storageToDisplay } from '../../../utils'
import type { DisplayColumn } from '../types'

/**
 * Discriminated union describing every shape a table cell can take.
 *
 * Workflow-output cells follow a status state machine: they always render
 * *something* (a value, a status pill, or a dash), driven by the combination
 * of `executions[groupId]` state and dep satisfaction. Plain (non-workflow)
 * cells just render the typed value or empty.
 *
 * `'empty'` is the universal fallback used by both workflow cells (no exec,
 * no value, no waiting) and plain cells (null/undefined value).
 *
 * Adding a new cell appearance is a three-step mechanical change: add a
 * variant here, pick it in `resolveCellRender`, render it in `CellRender`.
 * TypeScript's exhaustiveness check on the renderer's `switch` (the
 * unreachable default) flags any branch you forgot.
 */
export type CellRenderKind =
  // Workflow-output cells
  | { kind: 'value'; text: string }
  | { kind: 'block-error' }
  | { kind: 'running' }
  | { kind: 'pending-upstream' }
  | { kind: 'queued' }
  | { kind: 'cancelled' }
  | { kind: 'error' }
  | { kind: 'waiting'; labels: string[] }
  // Plain typed cells
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'json'; text: string }
  | { kind: 'date'; text: string }
  | { kind: 'text'; text: string }
  // Universal fallback
  | { kind: 'empty' }

interface ResolveCellRenderInput {
  value: unknown
  exec: RowExecutionMetadata | undefined
  column: DisplayColumn
  /** Empty / undefined → not waiting; non-empty → render the Waiting pill. */
  waitingOnLabels: string[] | undefined
}

/**
 * Decide which `CellRenderKind` to render for a cell. Pure — easily
 * unit-testable in isolation, no JSX involved.
 *
 * Order matters for workflow cells: block-error wins over a value (the user
 * cares about the failure), value wins over running/queued (we have data
 * already), and the running/queued branch deliberately collapses pre-enqueue
 * `pending` and post-enqueue `queued` into one `Queued` pill so the cell
 * doesn't flicker as the row transitions from one to the other.
 */
export function resolveCellRender({
  value,
  exec,
  column,
  waitingOnLabels,
}: ResolveCellRenderInput): CellRenderKind {
  const isNull = value === null || value === undefined

  if (column.workflowGroupId) {
    const blockId = column.outputBlockId
    const blockError = blockId ? exec?.blockErrors?.[blockId] : undefined
    const blockRunning = blockId ? (exec?.runningBlockIds?.includes(blockId) ?? false) : false
    const groupHasBlockErrors = !!(exec?.blockErrors && Object.keys(exec.blockErrors).length > 0)

    if (blockError) return { kind: 'block-error' }

    // Active re-run of THIS column wins over its prior value — the value is
    // about to be overwritten and the user should see the cell is changing.
    const inFlight =
      exec?.status === 'running' || exec?.status === 'queued' || exec?.status === 'pending'
    if (inFlight && blockRunning) return { kind: 'running' }

    // Value wins over `pending-upstream`: once this column's output has
    // landed, the cell is done from the user's perspective — even if the
    // group is still running other blocks downstream. Without this, mid-run
    // partial-write events (`status: 'running'` carrying outputs but tagging
    // a different block as running) would flip a finished column back to the
    // amber Pending pill until the terminal `completed` event arrives.
    if (!isNull) return { kind: 'value', text: stringifyValue(value) }

    if (inFlight && !(groupHasBlockErrors && !blockRunning)) {
      if (exec?.status === 'queued' || exec?.status === 'pending') return { kind: 'queued' }
      // `running` with this block not in `runningBlockIds` and no value yet =
      // upstream block still going; surface as the amber Pending pill.
      return { kind: 'pending-upstream' }
    }

    // Waiting wins over a stale terminal state: if deps are unmet right now,
    // the prior `cancelled` / `error` is informational at best — the cell
    // can't actually run until the user fills the missing input. Surface the
    // actionable state instead of the stale one.
    if (waitingOnLabels && waitingOnLabels.length > 0) {
      return { kind: 'waiting', labels: waitingOnLabels }
    }
    if (exec?.status === 'cancelled') return { kind: 'cancelled' }
    if (exec?.status === 'error') return { kind: 'error' }
    return { kind: 'empty' }
  }

  if (column.type === 'boolean') return { kind: 'boolean', checked: Boolean(value) }
  if (isNull) return { kind: 'empty' }
  if (column.type === 'json') return { kind: 'json', text: JSON.stringify(value) }
  if (column.type === 'date') return { kind: 'date', text: String(value) }
  return { kind: 'text', text: stringifyValue(value) }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

interface CellRenderProps {
  kind: CellRenderKind
  /** When true the static content sits underneath the InlineEditor overlay
   *  and should be visually hidden (but kept in flow to preserve cell size). */
  isEditing: boolean
}

/**
 * Pure renderer: takes a `CellRenderKind` and returns the JSX. No business
 * logic — adding a new cell appearance means adding a new `case` here. The
 * exhaustiveness check on the `switch` (the unreachable default) flags any
 * variant you forgot to handle.
 */
export function CellRender({ kind, isEditing }: CellRenderProps): React.ReactElement | null {
  switch (kind.kind) {
    case 'value':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {kind.text}
        </span>
      )

    case 'block-error':
    case 'error':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='error' />
        </Wrap>
      )

    case 'running':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='running' />
        </Wrap>
      )

    case 'pending-upstream':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='pending' />
        </Wrap>
      )

    case 'cancelled':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='cancelled' />
        </Wrap>
      )

    case 'queued':
      return (
        <Wrap isEditing={isEditing}>
          <Badge variant='gray' dot size='sm'>
            Queued
          </Badge>
        </Wrap>
      )

    case 'waiting':
      return (
        <Wrap isEditing={isEditing}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span>
                <Badge variant='gray' dot size='sm'>
                  Waiting
                </Badge>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              Waiting on {kind.labels.map((l) => `"${l}"`).join(', ')}
            </Tooltip.Content>
          </Tooltip.Root>
        </Wrap>
      )

    case 'boolean':
      return (
        <div
          className={cn('flex min-h-[20px] items-center justify-center', isEditing && 'invisible')}
        >
          <Checkbox size='sm' checked={kind.checked} className='pointer-events-none' />
        </div>
      )

    case 'json':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {kind.text}
        </span>
      )

    case 'date':
      return (
        <span className={cn('text-[var(--text-primary)]', isEditing && 'invisible')}>
          {storageToDisplay(kind.text)}
        </span>
      )

    case 'text':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {kind.text}
        </span>
      )

    case 'empty':
      return null

    default: {
      // Exhaustiveness guard: TypeScript flags this branch if a new
      // `CellRenderKind` variant is added without a matching `case` above.
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

/**
 * Workflow-output cells are hand-editable; while editing, the static content
 * must stay in flow (so the cell doesn't collapse) but be visually hidden so
 * the InlineEditor overlay shows through. Plain wrapper around any non-text
 * variant.
 */
function Wrap({ isEditing, children }: { isEditing: boolean; children: React.ReactNode }) {
  if (!isEditing) return <>{children}</>
  return <div className='invisible'>{children}</div>
}
