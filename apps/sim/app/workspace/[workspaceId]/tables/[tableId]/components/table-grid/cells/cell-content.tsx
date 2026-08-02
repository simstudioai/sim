'use client'

import type { ReactNode } from 'react'
import type { RowExecutionMetadata } from '@/lib/table'
import type { DisplayColumn } from '../types'
import { CellRender, resolveCellRender } from './cell-render'

interface CellContentProps {
  value: unknown
  exec?: RowExecutionMetadata
  column: DisplayColumn
  /**
   * Current workspace id — lets string cells holding an in-workspace resource URL
   * render as a tagged-resource chip instead of a plain external link.
   *
   * Optional, and that is the security seam: the chip's renderer mounts
   * workspace-authenticated list queries, so a surface with no workspace identity
   * (an anonymous share) passes `undefined` and the resolver never emits that kind.
   * See `cell-render.test.ts`.
   */
  workspaceId?: string
  isEditing: boolean
  /**
   * The editing surface, supplied by the host that owns the write path. Injected
   * rather than imported so a read-only surface never pulls the inline editor —
   * `apps/sim` has no `sideEffects: false`, so a static import would ship it
   * regardless of `isEditing`.
   */
  editor?: ReactNode
  /**
   * Human-readable labels for unmet deps on this row+group, used to render a
   * "Waiting" pill when the cell hasn't run because something it depends on
   * is empty. `undefined` (or empty) means no waiting state.
   */
  waitingOnLabels?: string[]
  /** Column is an enrichment output — a completed-but-empty cell renders "Not found". */
  isEnrichmentOutput?: boolean
}

/**
 * Glue layer: maps cell inputs to a typed `CellRenderKind` (via the pure
 * resolver) and renders the corresponding JSX (via the dumb renderer). The host's
 * `editor` sits on top when `isEditing` is true. Adding a new cell appearance is a
 * three-step mechanical change in the colocated files.
 */
export function CellContent({
  value,
  exec,
  column,
  workspaceId,
  isEditing,
  editor,
  waitingOnLabels,
  isEnrichmentOutput,
}: CellContentProps) {
  const kind = resolveCellRender({
    value,
    exec,
    column,
    waitingOnLabels,
    isEnrichmentOutput,
    currentWorkspaceId: workspaceId,
  })

  return (
    <>
      {isEditing && editor && (
        <div className='absolute inset-0 z-10 flex items-center px-0'>{editor}</div>
      )}
      <CellRender kind={kind} isEditing={isEditing} />
    </>
  )
}
