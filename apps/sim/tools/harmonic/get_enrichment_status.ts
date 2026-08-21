import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_ENRICHMENT_STATUS_OUTPUT_PROPERTIES,
  type HarmonicGetEnrichmentStatusParams,
  type HarmonicGetEnrichmentStatusResponse,
} from '@/tools/harmonic/types'
import {
  buildEnrichmentStatusUrl,
  harmonicHeaders,
  normalizeEnrichmentStatuses,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetEnrichmentStatusTool: ToolConfig<
  HarmonicGetEnrichmentStatusParams,
  HarmonicGetEnrichmentStatusResponse
> = {
  id: 'harmonic_get_enrichment_status',
  name: 'Harmonic Get Enrichment Status',
  description:
    'Check enrichment jobs Harmonic queued for people it did not already have, and read the person URN each one produced.',
  version: '1.0.0',
  oauth: { required: true, provider: 'harmonic' },
  errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Harmonic credential resolved by the connected account',
    },
    enrichmentUrns: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of Harmonic enrichment URNs or bare enrichment UUIDs from Enrich Person; may be a JSON-array string',
    },
  },

  request: {
    url: (params) => buildEnrichmentStatusUrl(params.enrichmentUrns),
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const enrichments = normalizeEnrichmentStatuses(await response.json())
    return { success: true, output: { enrichments, count: enrichments.length } }
  },

  outputs: {
    enrichments: {
      type: 'array',
      description: 'Status of each requested enrichment job',
      items: { type: 'object', properties: HARMONIC_ENRICHMENT_STATUS_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of enrichment statuses returned' },
  },
}
