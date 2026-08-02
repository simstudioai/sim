import { filterUndefined } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskResponse, ZohoDeskUpdateTicketParams } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket description',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution notes recorded on the ticket',
    },
    classification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket classification: Problem, Request, Question, or Others',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field values as a JSON object, keyed by custom field API name',
    },
  },

  request: {
    url: (params) =>
      `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(requireZohoDeskId(params.ticketId, 'Ticket ID'))}`,
    method: 'PATCH',
    headers: (params) => buildZohoDeskHeaders(params),
    body: (params) => {
      const body = filterUndefined({
        subject: params.subject,
        status: params.status,
        priority: params.priority,
        assigneeId: params.assigneeId,
        departmentId: params.departmentId,
        category: params.category,
        subCategory: params.subCategory,
        dueDate: params.dueDate,
        description: params.description,
        resolution: params.resolution,
        classification: params.classification,
        // Zoho's ticket PATCH names the custom-field object `cf`. `customFields`
        // exists only as a deprecated alias on other Desk resources (e.g. events)
        // and on the separate validate-field-updates endpoint - sending it here
        // is silently ignored, so the update reports success without applying.
        cf: params.customFields,
      })
      // Zoho rejects an empty PATCH; fail early with an actionable message
      // instead of surfacing an opaque Zoho error for a no-op update.
      if (Object.keys(body).length === 0) {
        throw new Error(
          'No fields to update. Provide at least one field to change (e.g. status, priority, or subject).'
        )
      }
      return body
    },
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
