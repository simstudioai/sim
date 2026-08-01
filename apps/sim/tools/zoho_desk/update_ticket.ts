import { filterUndefined } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskResponse, ZohoDeskUpdateTicketParams } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
} from '@/tools/zoho_desk/utils'

export const zohoDeskUpdateTicketTool: ToolConfig<ZohoDeskUpdateTicketParams, ZohoDeskResponse> = {
  id: 'zoho_desk_update_ticket',
  name: 'Zoho Desk Update Ticket',
  description: 'Update fields on an existing Zoho Desk ticket.',
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
      description: 'Ticket ID to update',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket subject',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket status (e.g. Open, Closed)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket priority (e.g. High)',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignee (agent) ID',
    },
    departmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department ID',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket category',
    },
    subCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket sub-category',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (ISO 8601)',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field values as a JSON object',
    },
    ignoreSourceId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Source ID echoed back on the resulting webhook event so this write can be filtered out (loop guard)',
    },
  },

  request: {
    url: (params) => `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(params.ticketId)}`,
    method: 'PATCH',
    headers: (params) => {
      const headers = buildZohoDeskHeaders(params)
      // Echo the webhook subscription's ignoreSourceId so Zoho tags the resulting
      // Ticket_Update event with this sourceId, letting our own trigger drop self-writes.
      if (params.ignoreSourceId) headers.sourceId = params.ignoreSourceId
      return headers
    },
    body: (params) =>
      filterUndefined({
        subject: params.subject,
        status: params.status,
        priority: params.priority,
        assigneeId: params.assigneeId,
        departmentId: params.departmentId,
        category: params.category,
        subCategory: params.subCategory,
        dueDate: params.dueDate,
        customFields: params.customFields,
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to update ticket (HTTP ${response.status})`)
      )
    }
    return {
      success: true,
      output: { ticket: data },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'The updated ticket',
      properties: ZOHO_DESK_TICKET_PROPERTIES,
    },
  },
}
