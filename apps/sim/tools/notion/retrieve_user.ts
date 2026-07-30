import type { NotionRetrieveUserParams } from '@/tools/notion/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionRetrieveUserResponse {
  success: boolean
  output: {
    id: string
    type: string | null
    name: string | null
    avatar_url: string | null
    email: string | null
  }
}

export const notionRetrieveUserTool: ToolConfig<
  NotionRetrieveUserParams,
  NotionRetrieveUserResponse
> = {
  id: 'notion_retrieve_user',
  name: 'Notion Retrieve User',
  description: 'Retrieve a single Notion user by their UUID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'notion',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Notion OAuth access token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the user to retrieve',
    },
  },

  request: {
    url: (params: NotionRetrieveUserParams) =>
      `https://api.notion.com/v1/users/${params.userId.trim()}`,
    method: 'GET',
    headers: (params: NotionRetrieveUserParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: response.ok,
      output: {
        id: data.id,
        type: data.type ?? null,
        name: data.name ?? null,
        avatar_url: data.avatar_url ?? null,
        email: data.person?.email ?? null,
      },
    }
  },

  outputs: {
    id: USER_OUTPUT_PROPERTIES.id,
    type: USER_OUTPUT_PROPERTIES.type,
    name: USER_OUTPUT_PROPERTIES.name,
    avatar_url: USER_OUTPUT_PROPERTIES.avatar_url,
    email: {
      type: 'string',
      description: 'User email address (person users only)',
      optional: true,
    },
  },
}

export const notionRetrieveUserV2Tool: ToolConfig<
  NotionRetrieveUserParams,
  NotionRetrieveUserResponse
> = {
  id: 'notion_retrieve_user_v2',
  name: 'Notion Retrieve User',
  description: 'Retrieve a single Notion user by their UUID',
  version: '2.0.0',
  oauth: notionRetrieveUserTool.oauth,
  params: notionRetrieveUserTool.params,
  request: notionRetrieveUserTool.request,
  transformResponse: notionRetrieveUserTool.transformResponse,
  outputs: notionRetrieveUserTool.outputs,
}
