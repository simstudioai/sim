import type { RipplingCreateGroupParams, RipplingCreateGroupResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateGroupTool: ToolConfig<
  RipplingCreateGroupParams,
  RipplingCreateGroupResponse
> = {
  id: 'rippling_create_group',
  name: 'Rippling Create Group',
  description: 'Create a new group in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the group',
    },
    spokeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Third-party app identifier',
    },
    users: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of user ID strings to add to the group',
    },
  },

  request: {
    url: 'https://api.rippling.com/platform/api/groups',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        spokeId: params.spokeId,
      }
      if (params.users !== undefined) {
        body.users = params.users
      }
      return body
    },
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
        name: (data.name as string) ?? null,
        spokeId: (data.spokeId as string) ?? null,
        users: (data.users as string[]) ?? [],
        version: (data.version as number) ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Group ID' },
    name: { type: 'string', description: 'Group name' },
    spokeId: { type: 'string', description: 'Third-party app identifier' },
    users: {
      type: 'array',
      description: 'Array of user IDs in the group',
      items: { type: 'string' },
    },
    version: { type: 'number', description: 'Group version number' },
  },
}
