import {
  QUARTR_COMPANY_OUTPUT_PROPERTIES,
  type QuartrCompanyDto,
  type QuartrGetCompanyParams,
  type QuartrGetCompanyResponse,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrCompany, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetCompanyTool: ToolConfig<QuartrGetCompanyParams, QuartrGetCompanyResponse> = {
  id: 'quartr_get_company',
  name: 'Quartr Get Company',
  description: 'Retrieve a single company from Quartr by its company ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    companyId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr company ID (e.g., 4742)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl(`/companies/${encodeURIComponent(String(params.companyId).trim())}`),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrCompanyDto>>(
      response,
      'get company'
    )

    return {
      success: true,
      output: {
        company: mapQuartrCompany(data.data),
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'The requested company',
      properties: QUARTR_COMPANY_OUTPUT_PROPERTIES,
    },
  },
}
