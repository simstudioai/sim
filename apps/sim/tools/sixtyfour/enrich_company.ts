import type {
  SixtyfourEnrichCompanyParams,
  SixtyfourEnrichCompanyResponse,
} from '@/tools/sixtyfour/types'
import type { ToolConfig } from '@/tools/types'

export const sixtyfourEnrichCompanyTool: ToolConfig<
  SixtyfourEnrichCompanyParams,
  SixtyfourEnrichCompanyResponse
> = {
  id: 'sixtyfour_enrich_company',
  name: 'Sixtyfour Enrich Company',
  description:
    'Enrich company data with additional information and find associated people using Sixtyfour AI.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sixtyfour API key',
    },
    targetCompany: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company data as JSON object (e.g. {"name": "Acme Inc", "domain": "acme.com"})',
    },
    struct: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Fields to collect as JSON object. Keys are field names, values are descriptions (e.g. {"website": "Company website URL", "num_employees": "Employee count"})',
    },
    findPeople: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to find people associated with the company',
    },
    fullOrgChart: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to retrieve the full organizational chart',
    },
    researchPlan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional strategy describing how the agent should search for information',
    },
    peopleFocusPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of people to find (roles, responsibilities)',
    },
    leadStruct: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom schema for returned lead data as JSON object',
    },
  },

  request: {
    url: 'https://api.sixtyfour.ai/enrich-company',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      let targetCompany: unknown
      try {
        targetCompany =
          typeof params.targetCompany === 'string'
            ? JSON.parse(params.targetCompany)
            : params.targetCompany
      } catch {
        throw new Error('targetCompany must be valid JSON')
      }
      let struct: unknown
      try {
        struct = typeof params.struct === 'string' ? JSON.parse(params.struct) : params.struct
      } catch {
        throw new Error('struct must be valid JSON')
      }
      let leadStruct: Record<string, unknown> | undefined
      try {
        leadStruct =
          params.leadStruct && typeof params.leadStruct === 'string'
            ? (JSON.parse(params.leadStruct) as Record<string, unknown>)
            : (params.leadStruct as Record<string, unknown> | undefined)
      } catch {
        throw new Error('leadStruct must be valid JSON')
      }
      return {
        target_company: targetCompany,
        struct,
        ...(params.findPeople !== undefined && { find_people: params.findPeople }),
        ...(params.fullOrgChart !== undefined && { full_org_chart: params.fullOrgChart }),
        ...(params.researchPlan && { research_plan: params.researchPlan }),
        ...(params.peopleFocusPrompt && { people_focus_prompt: params.peopleFocusPrompt }),
        ...(leadStruct && { lead_struct: leadStruct }),
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
    notes: { type: 'string', description: 'Research notes about the company', optional: true },
    structuredData: {
      type: 'json',
      description: 'Enriched company data matching the requested struct fields',
    },
    references: { type: 'json', description: 'Source URLs and descriptions used for enrichment' },
    confidenceScore: {
      type: 'number',
      description: 'Quality score for the returned data (0-10)',
      optional: true,
    },
  },
}
