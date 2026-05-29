import { ALL_ENRICHMENTS } from '@/enrichments'
import { mapFieldType } from '@/enrichments/providers'
import type { EnrichmentRunParams, EnrichmentRunResponse } from '@/tools/enrichment/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

/** Union of every distinct output across all registry enrichments. */
const enrichmentOutputs: Record<string, OutputProperty> = {}
for (const enrichment of ALL_ENRICHMENTS) {
  for (const output of enrichment.outputs) {
    if (!enrichmentOutputs[output.id]) {
      enrichmentOutputs[output.id] = {
        type: mapFieldType(output.type),
        description: `${output.name} (from the selected enrichment)`,
        optional: true,
      }
    }
  }
}

/**
 * Runs a registry enrichment via `/api/tools/enrichment/run`. Selected and fed
 * by the Enrichment block; the route runs the provider cascade with the
 * workspace's hosted / BYOK key.
 */
export const enrichmentRunTool: ToolConfig<EnrichmentRunParams, EnrichmentRunResponse> = {
  id: 'enrichment_run',
  name: 'Run Enrichment',
  description: 'Run a Sim enrichment (e.g. Work Email, Phone Number) and return its outputs',
  version: '1.0.0',

  params: {
    enrichmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Registry enrichment id (e.g. "work-email")',
    },
    inputs: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: "Map of the enrichment's input ids to values",
    },
  },

  request: {
    url: '/api/tools/enrichment/run',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params: EnrichmentRunParams & { _context?: { workspaceId?: string } }) => ({
      enrichmentId: params.enrichmentId,
      inputs: params.inputs ?? {},
      workspaceId: params._context?.workspaceId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.error) {
      return {
        success: false,
        output: { matched: false, provider: null },
        error: data.error || `Enrichment failed (${response.status})`,
      }
    }
    const result = (data.result ?? {}) as Record<string, unknown>
    const cost = typeof data.cost === 'number' ? data.cost : 0
    const provider = typeof data.provider === 'string' ? data.provider : null
    return {
      success: true,
      output: {
        ...result,
        matched: Boolean(data.matched),
        provider,
        // Surface hosted-key cost so the workflow logging session bills it,
        // matching the convention used by hosted-key tools.
        ...(cost > 0 ? { cost: { total: cost } } : {}),
      },
    }
  },

  // Reserved keys go LAST so they always win if an enrichment ever declares an
  // output id of `matched` or `provider` (later spread / assignment wins in JS).
  outputs: {
    ...enrichmentOutputs,
    matched: { type: 'boolean', description: 'Whether the enrichment found a result' },
    provider: {
      type: 'string',
      description: 'Provider whose result was returned (e.g. "Hunter", "People Data Labs")',
      optional: true,
    },
  },
}
