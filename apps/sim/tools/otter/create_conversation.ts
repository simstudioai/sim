import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  OtterCreateConversationParams,
  OtterCreateConversationResponse,
} from '@/tools/otter/types'
import { OTTER_API_BASE, otterHeaders } from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'

export const otterCreateConversationTool: ToolConfig<
  OtterCreateConversationParams,
  OtterCreateConversationResponse
> = {
  id: 'otter_create_conversation',
  name: 'Otter Import Recording',
  description:
    'Import an audio or video recording into Otter as a new conversation from a publicly reachable file URL.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Otter API key',
    },
    fileUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the recording to import (e.g., https://example.com/call.mp4)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the new conversation',
    },
  },

  request: {
    url: `${OTTER_API_BASE}/conversations`,
    method: 'POST',
    headers: (params) => ({
      ...otterHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const file = params.fileUrl?.trim()
      if (!file) throw new Error('File URL is required')
      const name = params.name?.trim()
      return { file, ...(name ? { name } : {}) }
    },
  },

  transformResponse: async (response: Response) => {
    const body = toRecord(await response.json())
    return {
      success: true,
      output: {
        status: toStringOrNull(body.status),
        completedAt: toStringOrNull(body.completed_at),
        file: toStringOrNull(body.file),
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Import status (e.g., success)',
      nullable: true,
    },
    completedAt: {
      type: 'string',
      description: 'When the import completed',
      nullable: true,
    },
    file: {
      type: 'string',
      description: 'Name of the imported file',
      nullable: true,
    },
  },
}
