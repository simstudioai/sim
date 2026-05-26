import type React from 'react'
import type { ColumnDefinition } from '@/lib/table'

/** One per-row input an enrichment needs. Mapped to a table column by the user. */
export interface EnrichmentInputField {
  /** Stable key passed into `enrich()` (`inputs[id]`). */
  id: string
  /** Human label shown in the config panel. */
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description?: string
}

/** One value an enrichment produces. Becomes a table column. */
export interface EnrichmentOutputField {
  /** Key the value is returned under from `enrich()` (`result[id]`). */
  id: string
  /** Default column name. */
  name: string
  type: ColumnDefinition['type']
}

/** Per-row execution context handed to `enrich()` (runs server-side). */
export interface EnrichmentRunContext {
  tableId: string
  rowId: string
  workspaceId: string
  signal?: AbortSignal
}

/**
 * A code-defined enrichment. Runs directly per table row (no workflow): the
 * table's per-cell executor calls `enrich()` with the mapped inputs and writes
 * each returned output value into its column.
 */
export interface EnrichmentConfig {
  id: string
  name: string
  description: string
  /** Shown in the catalog + (future) column header. */
  icon: React.ComponentType<{ className?: string }>
  inputs: EnrichmentInputField[]
  outputs: EnrichmentOutputField[]
  /** Returns `{ [outputId]: value }`. Throwing surfaces as a per-cell error. */
  enrich: (
    inputs: Record<string, unknown>,
    ctx: EnrichmentRunContext
  ) => Promise<Record<string, unknown>>
}

export type EnrichmentRegistry = Record<string, EnrichmentConfig>
