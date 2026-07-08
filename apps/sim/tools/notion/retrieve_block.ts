import { BLOCK_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export interface NotionRetrieveBlockParams {
  blockId: string
  accessToken: string
}

interface NotionRetrieveBlockResponse {
  success: boolean
  output: {
    id: string
    type: string
    has_children: boolean
    archived: boolean
    block: Record<string, any>
  }
}

export const notionRetrieveBlockTool: ToolConfig<
  NotionRetrieveBlockParams,
  NotionRetrieveBlockResponse
> = {
  id: 'notion_retrieve_block',
  name: 'Notion Retrieve Block',
  description: 'Retrieve a single Notion block by its UUID, including its type-specific content',
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
    blockId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the block to retrieve',
    },
  },

  request: {
    url: (params: NotionRetrieveBlockParams) =>
      `https://api.notion.com/v1/blocks/${params.blockId.trim()}`,
    method: 'GET',
    headers: (params: NotionRetrieveBlockParams) => {
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
        type: data.type ?? '',
        has_children: data.has_children ?? false,
        archived: data.archived ?? false,
        block: data,
      },
    }
  },

  outputs: {
    id: BLOCK_OUTPUT_PROPERTIES.id,
    type: BLOCK_OUTPUT_PROPERTIES.type,
    has_children: BLOCK_OUTPUT_PROPERTIES.has_children,
    archived: BLOCK_OUTPUT_PROPERTIES.archived,
    block: {
      type: 'object',
      description:
        'The full Notion block object. Includes a type-specific field (e.g. paragraph, heading_1, image) whose shape varies by block type and is not enumerated below — read it directly off this object.',
      properties: BLOCK_OUTPUT_PROPERTIES,
    },
  },
}

export const notionRetrieveBlockV2Tool: ToolConfig<
  NotionRetrieveBlockParams,
  NotionRetrieveBlockResponse
> = {
  id: 'notion_retrieve_block_v2',
  name: 'Notion Retrieve Block',
  description: 'Retrieve a single Notion block by its UUID, including its type-specific content',
  version: '2.0.0',
  oauth: notionRetrieveBlockTool.oauth,
  params: notionRetrieveBlockTool.params,
  request: notionRetrieveBlockTool.request,
  transformResponse: notionRetrieveBlockTool.transformResponse,
  outputs: notionRetrieveBlockTool.outputs,
}
