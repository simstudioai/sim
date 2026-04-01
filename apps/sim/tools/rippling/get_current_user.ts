import type { RipplingGetCurrentUserParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCurrentUserTool: ToolConfig<RipplingGetCurrentUserParams> = {
  id: 'rippling_get_current_user',
  name: 'Rippling Get Current User',
  description: 'Get SSO information for the current user',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
  },
  request: {
    url: (params) => {
      const base = `https://rest.ripplingapis.com/sso-me/`
      if (params.expand) return `${base}?expand=${encodeURIComponent(params.expand)}`
      return base
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
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
        work_email: (data.work_email as string) ?? null,
        company_id: (data.company_id as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'User ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    work_email: { type: 'string', description: 'Work email' },
    company_id: { type: 'string', description: 'Company ID' },
  },
}
