import { ALL_ENRICHMENTS } from '@/enrichments'
import { mapFieldType } from '@/enrichments/providers'
import type { EnrichmentRunParams, EnrichmentRunResponse } from '@/tools/enrichment/types'
import type { InternalToolConfig, OutputProperty } from '@/tools/types'

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
 * Runs a registry enrichment's provider cascade with the workspace's hosted or BYOK key.
 */
export const enrichmentRunTool: InternalToolConfig<EnrichmentRunParams, EnrichmentRunResponse> = {
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

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ enrichmentId: params.enrichmentId, inputs: params.inputs }),
    },
    input: (params) => ({
      enrichmentId: params.enrichmentId,
      inputs: params.inputs ?? {},
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
        ...(cost > 0 ? { cost: { total: cost } } : {}),
      },
    }
  },

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
