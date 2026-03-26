import type { RipplingUpdateGroupParams, RipplingUpdateGroupResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateGroupTool: ToolConfig<
  RipplingUpdateGroupParams,
  RipplingUpdateGroupResponse
> = {
  id: 'rippling_update_group',
  name: 'Rippling Update Group',
  description: 'Update an existing group in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the group to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the group',
    },
    spokeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Third-party app identifier',
    },
    users: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of user ID strings to set for the group',
    },
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group version number for optimistic concurrency',
    },
  },

  request: {
    url: (params) =>
      `https://api.rippling.com/platform/api/groups/${encodeURIComponent(params.groupId.trim())}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) {
        body.name = params.name
      }
      if (params.spokeId !== undefined) {
        body.spokeId = params.spokeId
      }
      if (params.users !== undefined) {
        body.users = params.users
      }
      if (params.version !== undefined) {
        body.version = params.version
      }
      if (Object.keys(body).length === 0) {
        throw new Error(
          'At least one field (name, spokeId, users, or version) must be provided to update a group.'
        )
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
