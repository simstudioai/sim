import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TAG_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTag,
} from '@/tools/clickup/shared'
import type {
  ClickUpGetSpaceTagsParams,
  ClickUpTag,
  ClickUpTagListResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetSpaceTagsTool: ToolConfig<ClickUpGetSpaceTagsParams, ClickUpTagListResponse> =
  {
    id: 'clickup_get_space_tags',
    name: 'ClickUp Get Space Tags',
    description: 'List the task tags available in a ClickUp space',
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
      spaceId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the space to list tags from',
      },
    },

    request: {
      url: (params) => `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(params.spaceId)}/tag`,
      method: 'GET',
      headers: (params) => ({
        Authorization: clickupAuthorizationHeader(params.accessToken),
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractClickUpErrorMessage(response, data, 'Failed to get space tags')
        return { success: false, output: { error }, error }
      }

      const rawTags = Array.isArray(data?.tags) ? data.tags : []

      return {
        success: true,
        output: {
          tags: rawTags
            .map((tag: unknown) => mapClickUpTag(tag))
            .filter((tag: ClickUpTag | null): tag is ClickUpTag => tag !== null),
        },
      }
    },

    outputs: {
      tags: {
        type: 'array',
        description: 'Tags available in the space',
        optional: true,
        items: {
          type: 'object',
          properties: CLICKUP_TAG_OUTPUT_PROPERTIES,
        },
      },
    },
  }
