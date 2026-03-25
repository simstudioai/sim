import type {
  RipplingGetCurrentUserParams,
  RipplingGetCurrentUserResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCurrentUserTool: ToolConfig<
  RipplingGetCurrentUserParams,
  RipplingGetCurrentUserResponse
> = {
  id: 'rippling_get_current_user',
  name: 'Rippling Get Current User',
  description: 'Get the current authenticated user details',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
  },

  request: {
    url: 'https://api.rippling.com/platform/api/me',
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
        id: data.id ?? '',
        workEmail: data.workEmail ?? null,
        company: data.company ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    workEmail: { type: 'string', description: 'Work email address', optional: true },
    company: { type: 'string', description: 'Company ID', optional: true },
  },
}
