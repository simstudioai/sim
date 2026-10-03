import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskResponse, ZohoDeskUpdateTicketParams } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

/**
 * Drop keys the caller did not set, so a PATCH only carries real edits.
 *
 * Deliberately NOT `filterUndefined`: that helper strips `undefined` only, but an
 * untouched subBlock does not arrive as `undefined` - the workflow serializer
 * initializes every subBlock value to `null` and writes those nulls straight into
 * tool params. A status-only update therefore reached Zoho as
 * `{"subject": null, "status": "Closed"}`, which either fails the PATCH or blanks
 * the ticket's subject.
 *
 * An empty string is NOT treated as unset. Zoho's own PATCH sample payload
 * carries `"classification": ""` and `"productId": ""`, so `''` is the only
 * clear-a-field signal the API surfaces (Zoho states no prose contract for it) -
 * collapsing `''` into "leave unchanged" would make clearing `classification`,
 * `category`, `subCategory`, `resolution` or `description` impossible through
 * this tool. `null` (never touched) and `''` (deliberately emptied) are
 * different intents and are kept distinct.
 */
function omitUnset(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    result[key] = value
  }
  return result
}

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
      // Not a closed set: Zoho marks the field `x-dynamic-enum` and states
      // "Custom values are also supported", so a portal can rename or replace
      // the system-defined values entirely.
      description:
        'Ticket classification. Zoho\'s system-defined values are Problem, Request, and Question; portals can define custom values. Pass "" to clear it.',
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
      const body = omitUnset({
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
        // Zoho's ticket PATCH documents both `cf` and `customFields`, but marks
        // `customFields` deprecated. Its own sample body sends `cf`, so that is
        // what we use.
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
    // The PATCH response is the updated ticket, so derive `descriptionText` the
    // same way get_ticket does - the shared output map declares it.
    return {
      success: true,
      output: { ticket: withDerivedContentText(data) },
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
