import type { RipplingGetEmploymentTypeParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetEmploymentTypeTool: ToolConfig<RipplingGetEmploymentTypeParams> = {
  id: 'rippling_get_employment_type',
  name: 'Rippling Get Employment Type',
  description: 'Get a specific employment type by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/employment-types/${encodeURIComponent(params.id.trim())}/`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        label: (data.label as string) ?? null,
        name: (data.name as string) ?? null,
        type: (data.type as string) ?? null,
        compensation_time_period: (data.compensation_time_period as string) ?? null,
        amount_worked: (data.amount_worked as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Employment type ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    label: { type: 'string', description: 'Label', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    type: { type: 'string', description: 'Type (CONTRACTOR, EMPLOYEE)', optional: true },
    compensation_time_period: {
      type: 'string',
      description: 'Compensation period (HOURLY, SALARIED)',
      optional: true,
    },
    amount_worked: {
      type: 'string',
      description: 'Amount worked (PART-TIME, FULL-TIME, TEMPORARY)',
      optional: true,
    },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
