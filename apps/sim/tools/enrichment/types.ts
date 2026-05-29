import type { ToolResponse } from '@/tools/types'

export interface EnrichmentRunParams {
  /** Registry enrichment id (e.g. `work-email`). */
  enrichmentId: string
  /** Map of the enrichment's input ids → values. */
  inputs: Record<string, unknown>
}

export interface EnrichmentRunResponse extends ToolResponse {
  output: {
    /** Whether the enrichment found a result. */
    matched: boolean
    /** Label of the provider whose result was returned, null on no match. */
    provider: string | null
  } & Record<string, unknown>
}
