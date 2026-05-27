import { ALL_ENRICHMENTS } from '@/enrichments'
import type { EnrichmentOutputField } from '@/enrichments/types'
import type { EnrichmentRunParams, EnrichmentRunResponse } from '@/tools/enrichment/types'
import type { OutputProperty, OutputType, ToolConfig } from '@/tools/types'

/** Maps an enrichment output's column type to a tool OutputType. */
function toOutputType(type: EnrichmentOutputField['type']): OutputType {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'json'
    default:
      return 'string'
  }
}

/** Union of every distinct output across all registry enrichments. */
const enrichmentOutputs: Record<string, OutputProperty> = {}
for (const enrichment of ALL_ENRICHMENTS) {
  for (const output of enrichment.outputs) {
    if (!enrichmentOutputs[output.id]) {
      enrichmentOutputs[output.id] = {
        type: toOutputType(output.type),
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

  outputs: {
    matched: { type: 'boolean', description: 'Whether the enrichment found a result' },
    provider: {
      type: 'string',
      description: 'Provider whose result was returned (e.g. "Hunter", "People Data Labs")',
      optional: true,
    },
    ...enrichmentOutputs,
  },
}
