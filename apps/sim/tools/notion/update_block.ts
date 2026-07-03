import type { NotionUpdateBlockParams } from '@/tools/notion/types'
import { BLOCK_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionUpdateBlockResponse {
  success: boolean
  output: {
    id: string
    type: string
    archived: boolean
    block: Record<string, any>
  }
}

/**
 * Coerce the block param into an object, accepting either a JSON string
 * (when called directly by an agent) or an already-parsed object.
 */
function parseBlock(block: Record<string, any> | string): Record<string, any> {
  if (typeof block === 'string') {
    const parsed = JSON.parse(block)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('block must be a JSON object describing the block-type fields to update')
    }
    return parsed
  }
  if (typeof block === 'object' && block !== null && !Array.isArray(block)) return block
  throw new Error('block must be a JSON object describing the block-type fields to update')
}

export const notionUpdateBlockTool: ToolConfig<NotionUpdateBlockParams, NotionUpdateBlockResponse> =
  {
    id: 'notion_update_block',
    name: 'Notion Update Block',
    description: 'Update the content or archived state of a single Notion block',
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
        description: 'The UUID of the block to update',
      },
      block: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Block-type object with the fields to update, e.g. {"paragraph": {"rich_text": [...]}}',
      },
      archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Set to true to archive (delete) the block, or false to restore it',
      },
    },

    request: {
      url: (params: NotionUpdateBlockParams) =>
        `https://api.notion.com/v1/blocks/${params.blockId.trim()}`,
      method: 'PATCH',
      headers: (params: NotionUpdateBlockParams) => {
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }

        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        }
      },
      body: (params: NotionUpdateBlockParams) => {
        const body: Record<string, any> = parseBlock(params.block)
        if (params.archived != null) body.archived = params.archived
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: response.ok,
        output: {
          id: data.id,
          type: data.type ?? '',
          archived: data.archived ?? false,
          block: data,
        },
      }
    },

    outputs: {
      id: BLOCK_OUTPUT_PROPERTIES.id,
      type: BLOCK_OUTPUT_PROPERTIES.type,
      archived: BLOCK_OUTPUT_PROPERTIES.archived,
      block: {
        type: 'object',
        description: 'The full updated Notion block object',
        properties: BLOCK_OUTPUT_PROPERTIES,
      },
    },
  }

export const notionUpdateBlockV2Tool: ToolConfig<
  NotionUpdateBlockParams,
  NotionUpdateBlockResponse
> = {
  id: 'notion_update_block_v2',
  name: 'Notion Update Block',
  description: 'Update the content or archived state of a single Notion block',
  version: '2.0.0',
  oauth: notionUpdateBlockTool.oauth,
  params: notionUpdateBlockTool.params,
  request: notionUpdateBlockTool.request,
  transformResponse: notionUpdateBlockTool.transformResponse,
  outputs: notionUpdateBlockTool.outputs,
}
