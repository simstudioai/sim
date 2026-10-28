import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { readZohoDeskResponse } from '@/tools/zoho_desk/request'
import type { ZohoDeskGetThreadParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_THREAD_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskGetThreadTool: ToolConfig<ZohoDeskGetThreadParams, ZohoDeskResponse> = {
  id: 'zoho_desk_get_thread',
  name: 'Zoho Desk Get Thread',
  description: 'Retrieve the full content of a single Zoho Desk ticket thread.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zoho Desk organization ID',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID',
    },
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread ID',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Related data to embed. Allowed: plainText — Zoho's own plain-text rendering of the thread",
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const include = normalizeZohoDeskCommaList(params.include)
      if (include) query.set('include', include)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'Ticket ID')}/threads/${safeUrlPathSegment(params.threadId, 'Thread ID')}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { thread: withDerivedContentText(data) },
    }
  },

  outputs: {
    thread: { type: 'object', description: 'The thread', properties: ZOHO_DESK_THREAD_PROPERTIES },
  },
}
