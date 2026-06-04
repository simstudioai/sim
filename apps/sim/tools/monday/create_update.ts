import type { MondayCreateUpdateParams, MondayCreateUpdateResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayCreateUpdateTool: ToolConfig<
  MondayCreateUpdateParams,
  MondayCreateUpdateResponse
> = {
  id: 'monday_create_update',
  name: 'Monday Create Update',
  description: 'Add an update (comment) to a Monday.com item',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'monday',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Monday.com OAuth access token',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the item to add the update to',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The update text content (supports HTML)',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => ({
      query: `mutation { create_update(item_id: ${sanitizeNumericId(params.itemId, 'itemId')}, body: ${JSON.stringify(params.body)}) { id body text_body created_at creator_id item_id } }`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { update: null }, error }
    }

    const raw = data.data?.create_update
    if (!raw) {
      return { success: false, output: { update: null }, error: 'Failed to create update' }
    }

    return {
      success: true,
      output: {
        update: {
          id: raw.id as string,
          body: (raw.body as string) ?? '',
          textBody: (raw.text_body as string) ?? null,
          createdAt: (raw.created_at as string) ?? null,
          creatorId: (raw.creator_id as string) ?? null,
          itemId: (raw.item_id as string) ?? null,
        },
      },
    }
  },

  outputs: {
    update: {
      type: 'json',
      description: 'The created update',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Update ID' },
        body: { type: 'string', description: 'Update body (HTML)' },
        textBody: { type: 'string', description: 'Plain text body', optional: true },
        createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
        creatorId: { type: 'string', description: 'Creator user ID', optional: true },
        itemId: { type: 'string', description: 'Item ID', optional: true },
      },
    },
  },
}
