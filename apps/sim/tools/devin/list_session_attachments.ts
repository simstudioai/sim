import type { ToolConfig } from '@/tools/types'
import type {
  DevinListSessionAttachmentsParams,
  DevinListSessionAttachmentsResponse,
} from './types'
import { DEVIN_SESSION_ATTACHMENT_PROPERTIES } from './types'

export const devinListSessionAttachmentsTool: ToolConfig<
  DevinListSessionAttachmentsParams,
  DevinListSessionAttachmentsResponse
> = {
  id: 'devin_list_session_attachments',
  name: 'list_session_attachments',
  description: 'List the files uploaded to or produced by a Devin session.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin organization ID (prefixed with org-)',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session ID to list attachments for',
    },
  },

  request: {
    url: (params) =>
      `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}/attachments`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.items ?? [])
    return {
      success: true,
      output: {
        attachments: items.map((item: Record<string, unknown>) => ({
          attachmentId: item.attachment_id ?? null,
          name: item.name ?? null,
          url: item.url ?? null,
          source: item.source ?? null,
          contentType: item.content_type ?? null,
        })),
      },
    }
  },

  outputs: {
    attachments: {
      type: 'array',
      description: 'Attachments associated with the session',
      items: {
        type: 'object',
        properties: DEVIN_SESSION_ATTACHMENT_PROPERTIES,
      },
    },
  },
}
