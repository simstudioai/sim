import type { NotionDeleteBlockParams } from '@/tools/notion/types'
import { BLOCK_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionDeleteBlockResponse {
  success: boolean
  output: {
    id: string
    archived: boolean
  }
}

export const notionDeleteBlockTool: ToolConfig<NotionDeleteBlockParams, NotionDeleteBlockResponse> =
  {
    id: 'notion_delete_block',
    name: 'Notion Delete Block',
    description: 'Delete (move to trash) a single Notion block',
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
        description: 'The UUID of the block to delete',
      },
    },

    request: {
      url: (params: NotionDeleteBlockParams) =>
        `https://api.notion.com/v1/blocks/${params.blockId.trim()}`,
      method: 'DELETE',
      headers: (params: NotionDeleteBlockParams) => {
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
          archived: data.archived ?? true,
        },
      }
    },

    outputs: {
      id: BLOCK_OUTPUT_PROPERTIES.id,
      archived: { type: 'boolean', description: 'Whether the block was archived (moved to trash)' },
    },
  }

export const notionDeleteBlockV2Tool: ToolConfig<
  NotionDeleteBlockParams,
  NotionDeleteBlockResponse
> = {
  id: 'notion_delete_block_v2',
  name: 'Notion Delete Block',
  description: 'Delete (move to trash) a single Notion block',
  version: '2.0.0',
  oauth: notionDeleteBlockTool.oauth,
  params: notionDeleteBlockTool.params,
  request: notionDeleteBlockTool.request,
  transformResponse: notionDeleteBlockTool.transformResponse,
  outputs: notionDeleteBlockTool.outputs,
}
