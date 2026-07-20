import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpSpace,
} from '@/tools/clickup/shared'
import type { ClickUpGetSpacesParams, ClickUpSpaceListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetSpacesTool: ToolConfig<ClickUpGetSpacesParams, ClickUpSpaceListResponse> = {
  id: 'clickup_get_spaces',
  name: 'ClickUp Get Spaces',
  description: 'List the spaces in a ClickUp workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the workspace (team) to list spaces from',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return archived spaces',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/space`
      )
      if (params.archived !== undefined) url.searchParams.set('archived', String(params.archived))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get spaces')
      return { success: false, output: { error }, error }
    }

    const rawSpaces = Array.isArray(data?.spaces) ? data.spaces : []

    return {
      success: true,
      output: { spaces: rawSpaces.map((space: unknown) => mapClickUpSpace(space)) },
    }
  },

  outputs: {
    spaces: {
      type: 'array',
      description: 'Spaces in the workspace',
      optional: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Space ID' },
          name: { type: 'string', description: 'Space name', nullable: true },
          private: { type: 'boolean', description: 'Whether the space is private', nullable: true },
          archived: {
            type: 'boolean',
            description: 'Whether the space is archived',
            nullable: true,
          },
          statuses: {
            type: 'array',
            description: 'Task statuses available in the space',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string', description: 'Status name', nullable: true },
                color: { type: 'string', description: 'Status color', nullable: true },
                type: { type: 'string', description: 'Status type', nullable: true },
              },
            },
          },
        },
      },
    },
  },
}
