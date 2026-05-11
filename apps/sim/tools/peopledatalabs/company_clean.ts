import type { PdlCleanCompanyParams, PdlCleanCompanyResponse } from '@/tools/peopledatalabs/types'
import { PDL_COMPANY_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { projectCompany } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const cleanCompanyTool: ToolConfig<PdlCleanCompanyParams, PdlCleanCompanyResponse> = {
  id: 'pdl_clean_company',
  name: 'PDL Company Cleaner',
  description:
    'Normalize a company string into a canonical company record. Provide at least one of name, website, or profile (LinkedIn URL).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Raw company name to normalize',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website',
    },
    profile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn company URL',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/company/clean',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.website) body.website = params.website
      if (params.profile) body.profile = params.profile
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return { success: true, output: { matched: false, company: null } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const hasFields = data.name || data.website || data.id
    return {
      success: true,
      output: {
        matched: Boolean(hasFields),
        company: hasFields ? projectCompany(data) : null,
      },
    }
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether the input was matched to a known company' },
    company: {
      type: 'object',
      description: 'Canonical company record',
      optional: true,
      properties: PDL_COMPANY_OUTPUT_PROPERTIES,
    },
  },
}
