import type {
  SixtyfourEnrichLeadParams,
  SixtyfourEnrichLeadResponse,
} from '@/tools/sixtyfour/types'
import type { ToolConfig } from '@/tools/types'

export const sixtyfourEnrichLeadTool: ToolConfig<
  SixtyfourEnrichLeadParams,
  SixtyfourEnrichLeadResponse
> = {
  id: 'sixtyfour_enrich_lead',
  name: 'Sixtyfour Enrich Lead',
  description:
    'Enrich lead information with contact details, social profiles, and company data using Sixtyfour AI.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sixtyfour API key',
    },
    leadInfo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Lead information as JSON object with key-value pairs (e.g. name, company, title, linkedin)',
    },
    struct: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Fields to collect as JSON object. Keys are field names, values are descriptions (e.g. {"email": "The individual\'s email address", "phone": "Phone number"})',
    },
    researchPlan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional research plan to guide enrichment strategy',
    },
  },

  request: {
    url: 'https://api.sixtyfour.ai/enrich-lead',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      let leadInfo: unknown
      try {
        leadInfo =
          typeof params.leadInfo === 'string' ? JSON.parse(params.leadInfo) : params.leadInfo
      } catch {
        throw new Error('leadInfo must be valid JSON')
      }
      let struct: unknown
      try {
        struct = typeof params.struct === 'string' ? JSON.parse(params.struct) : params.struct
      } catch {
        throw new Error('struct must be valid JSON')
      }
      return {
        lead_info: leadInfo,
        struct,
        ...(params.researchPlan && { research_plan: params.researchPlan }),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || data.message || data.detail || `API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        notes: data.notes ?? null,
        structuredData: data.structured_data ?? {},
        references: data.references ?? {},
        confidenceScore: data.confidence_score ?? null,
      },
    }
  },

  outputs: {
    notes: { type: 'string', description: 'Research notes about the lead', optional: true },
    structuredData: {
      type: 'json',
      description: 'Enriched lead data matching the requested struct fields',
    },
    references: { type: 'json', description: 'Source URLs and descriptions used for enrichment' },
    confidenceScore: {
      type: 'number',
      description: 'Quality score for the returned data (0-10)',
      optional: true,
    },
  },
}
