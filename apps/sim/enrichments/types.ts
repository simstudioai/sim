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
  /** Key the value is returned under from a provider's `run()` (`result[id]`). */
  id: string
  /** Default column name. */
  name: string
  type: ColumnDefinition['type']
}

/**
 * Execution context for an enrichment run (runs server-side). `tableId`/`rowId`
 * are present for the table per-row path but optional — the workflow block path
 * (`/api/tools/enrichment/run`) has no table/row and passes only `workspaceId`.
 */
export interface EnrichmentRunContext {
  tableId?: string
  rowId?: string
  workspaceId: string
  signal?: AbortSignal
}

/**
 * One data source an enrichment can try, described as plain data so the catalog
 * (which the table UI imports for metadata) never pulls in server-only tool
 * code. Providers are attempted in declared order (a fallback cascade); the
 * cascade runner (`run.ts`, server-only) calls the tool and the first provider
 * to return a non-empty result fills the cell.
 */
export interface EnrichmentProvider {
  /** Stable id for logs, e.g. `'hunter'`, `'pdl'`. */
  id: string
  /** Human label, e.g. `'Hunter'`, `'People Data Labs'`. */
  label: string
  /** Tool executed via `executeTool` (in the server-only runner). */
  toolId: string
  /**
   * Maps enrichment inputs to tool params, or `null` when there aren't enough
   * inputs to run this provider (cascade falls through to the next).
   */
  buildParams: (inputs: Record<string, unknown>) => Record<string, unknown> | null
  /**
   * Maps the tool's output to `{ [outputId]: value }`, or `null` for no result.
   * An empty/`null` result falls through to the next provider.
   */
  mapOutput: (output: Record<string, unknown>) => Record<string, unknown> | null
}

/**
 * A code-defined enrichment. Runs directly per table row (no workflow): the
 * table's per-cell executor runs the provider cascade with the mapped inputs
 * and writes each returned output value into its column.
 */
export interface EnrichmentConfig {
  id: string
  name: string
  description: string
  /** Shown in the catalog + (future) column header. */
  icon: React.ComponentType<{ className?: string }>
  inputs: EnrichmentInputField[]
  outputs: EnrichmentOutputField[]
  /** Data sources tried in order until one returns a non-empty result. */
  providers: EnrichmentProvider[]
}

export type EnrichmentRegistry = Record<string, EnrichmentConfig>
