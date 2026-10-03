import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HarmonicGetEmailEnrichmentUsageParams,
  HarmonicGetEmailEnrichmentUsageResponse,
} from '@/tools/harmonic/types'
import { HARMONIC_API_BASE, harmonicHeaders, responseRecord } from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetEmailEnrichmentUsageTool: ToolConfig<
  HarmonicGetEmailEnrichmentUsageParams,
  HarmonicGetEmailEnrichmentUsageResponse
> = {
  id: 'harmonic_get_email_enrichment_usage',
  name: 'Harmonic Get Email Enrichment Usage',
  description:
    'Read the team monthly email-enrichment quota. Check this before a large batch to avoid a quota rejection.',
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
  },

  request: {
    url: `${HARMONIC_API_BASE}/email_enrichment/usage`,
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'email enrichment usage')
    const counters = ['monthly_usage', 'monthly_limit', 'monthly_remaining'] as const
    for (const counter of counters) {
      if (typeof data[counter] !== 'number' || !Number.isFinite(data[counter] as number)) {
        throw new Error('Harmonic returned email enrichment usage without usable counters')
      }
    }

    return {
      success: true,
      output: {
        monthlyUsage: data.monthly_usage as number,
        monthlyLimit: data.monthly_limit as number,
        monthlyRemaining: data.monthly_remaining as number,
      },
    }
  },

  outputs: {
    monthlyUsage: { type: 'number', description: 'Emails enriched so far this month' },
    monthlyLimit: { type: 'number', description: 'Monthly email enrichment allowance' },
    monthlyRemaining: { type: 'number', description: 'Enrichments left this month' },
  },
}
