import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import {
  buildZohoDeskBody,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskMoveTicketParams, ZohoDeskMoveTicketResponse } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskMoveTicketTool: ToolConfig<
  ZohoDeskMoveTicketParams,
  ZohoDeskMoveTicketResponse
> = {
  id: 'zoho_desk_move_ticket',
  name: 'Zoho Desk Move Ticket',
  description: 'Move a ticket to another department.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID',
    },
    departmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the department to move the ticket',
    },
    forumId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the community sub-category to move the forum ticket (forum topic converted into a ticket).',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}/move`
    },
    method: 'POST',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        departmentId: params.departmentId,
        forumId: params.forumId,
      })
      return body
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) await readZohoDeskResponse(response)
    return { success: true, output: { completed: true } }
  },
  outputs: {
    completed: {
      type: 'boolean',
      description: 'Whether the requested operation completed successfully',
    },
  },
}
