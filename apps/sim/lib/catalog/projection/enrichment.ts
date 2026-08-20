import type { EnrichmentConfig, EnrichmentOutputField } from '@/enrichments/types'

/**
 * Surface-neutral projection of a table enrichment.
 *
 * Drops `icon` (a React component) and every provider closure (`buildParams`,
 * `mapOutput`). What survives is the part a caller needs: which inputs to map,
 * which columns get filled, and which data sources are tried.
 */

/** One per-row input an enrichment needs, mapped to a table column by the caller. */
export interface CatalogEnrichmentInput {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description?: string
}

/** One value an enrichment produces, which becomes a table column. */
export interface CatalogEnrichmentOutput {
  id: string
  name: string
  /**
   * Table column type the value is stored as. Typed against the column-type
   * registry rather than as a bare string, so adding a column type without
   * publishing it fails to compile here.
   */
  type: EnrichmentOutputField['type']
}

/** One data source in an enrichment's fallback cascade. */
export interface CatalogEnrichmentProvider {
  id: string
  label: string
  /** The built-in tool this provider executes. Resolve it with `GET /api/v2/tools/{toolId}`. */
  toolId: string
}

/** A code-defined enrichment that fills table cells from external data. */
export interface CatalogEnrichment {
  id: string
  name: string
  description: string
  inputs: CatalogEnrichmentInput[]
  outputs: CatalogEnrichmentOutput[]
  /**
   * Data sources in declared order. This IS the fallback cascade: providers are
   * attempted in this order and the first non-empty result fills the cell, so
   * the order is part of the behavior rather than presentation.
   */
  providers: CatalogEnrichmentProvider[]
}

/** Projects one enrichment config to its catalog entry. */
export function projectEnrichment(enrichment: EnrichmentConfig): CatalogEnrichment {
  return {
    id: enrichment.id,
    name: enrichment.name,
    description: enrichment.description,
    inputs: enrichment.inputs.map((input) => ({
      id: input.id,
      name: input.name,
      type: input.type,
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })),
    outputs: enrichment.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      type: output.type,
    })),
    providers: enrichment.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      toolId: provider.toolId,
    })),
  }
}
