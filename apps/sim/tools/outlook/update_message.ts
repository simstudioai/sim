import type {
  OutlookUpdateMessageParams,
  OutlookUpdateMessageResponse,
} from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

interface OutlookMessageUpdateApi {
  id: string
  subject?: string
  categories?: string[]
  flag?: { flagStatus?: string }
  importance?: string
  isRead?: boolean
}

/**
 * Normalize message categories into a trimmed string array. Accepts an array, a
 * JSON-array string, or a comma/newline-separated string (the `json`-typed param
 * can arrive in any of these forms from block inputs or agent tool-calls).
 */
function normalizeCategories(value: unknown): string[] {
  let items: unknown[] = []
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    try {
      const parsed = JSON.parse(trimmed)
      items = Array.isArray(parsed) ? parsed : trimmed.split(/[,\n]/)
    } catch {
      items = trimmed.split(/[,\n]/)
    }
  }
  return items.map((item) => String(item).trim()).filter(Boolean)
}

export const outlookUpdateMessageTool: ToolConfig<
  OutlookUpdateMessageParams,
  OutlookUpdateMessageResponse
> = {
  id: 'outlook_update_message',
  name: 'Outlook Update Message',
  description: 'Set the categories, follow-up flag, and importance on an Outlook message',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to update',
    },
    categories: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of category names to assign to the message (replaces existing categories; pass an empty array to clear all)',
    },
    flagStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Follow-up flag status: notFlagged, flagged, or complete',
    },
    importance: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message importance: low, normal, or high',
    },
  },

  request: {
    url: (params) => `https://graph.microsoft.com/v1.0/me/messages/${params.messageId.trim()}`,
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {}

      const rawCategories: unknown = params.categories
      if (Array.isArray(rawCategories)) {
        body.categories = normalizeCategories(rawCategories)
      } else if (typeof rawCategories === 'string') {
        const normalizedCategories = normalizeCategories(rawCategories)
        if (normalizedCategories.length > 0) {
          body.categories = normalizedCategories
        }
      }

      if (params.flagStatus) {
        body.flag = { flagStatus: params.flagStatus }
      }

      if (params.importance) {
        body.importance = params.importance
      }

      if (Object.keys(body).length === 0) {
        throw new Error('Provide at least one of categories, flagStatus, or importance to update')
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const message: OutlookMessageUpdateApi = await response.json()
    return {
      success: true,
      output: {
        message: 'Message updated successfully',
        results: {
          messageId: message.id,
          subject: message.subject ?? null,
          categories: message.categories ?? [],
          flagStatus: message.flag?.flagStatus ?? null,
          importance: message.importance ?? null,
          isRead: message.isRead ?? null,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    results: {
      type: 'object',
      description: 'Updated message details',
      properties: {
        messageId: { type: 'string', description: 'ID of the updated message' },
        subject: { type: 'string', description: 'Subject of the message', optional: true },
        categories: {
          type: 'array',
          description: 'Categories assigned to the message',
          items: { type: 'string' },
        },
        flagStatus: {
          type: 'string',
          description: 'Follow-up flag status of the message',
          optional: true,
        },
        importance: { type: 'string', description: 'Importance of the message', optional: true },
        isRead: { type: 'boolean', description: 'Whether the message is read', optional: true },
      },
    },
  },
}
