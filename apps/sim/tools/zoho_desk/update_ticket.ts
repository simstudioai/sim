import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { parseZohoDeskJson, readZohoDeskResponse } from '@/tools/zoho_desk/request'
import type { ZohoDeskResponse, ZohoDeskUpdateTicketParams } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
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
    ticketContactId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing contact ID',
    },
    contact: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact JSON with email or lastName; use instead of contactId',
    },
    productId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product ID',
    },
    uploads: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of previously uploaded attachment IDs',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket phone number',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket language',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket origin channel',
    },
    webUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to access the ticket',
    },
    sharedDepartments: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of shared departments and access privileges',
    },
    teamId: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Team ID' },
    secondaryContacts: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      maxItems: 20,
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of secondary contact IDs',
    },
    entitySkills: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      maxItems: 10,
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of skill IDs in priority order; at most 10',
    },
    disableClosureNotification: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Suppress the contact notification when closing the ticket',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'Ticket ID')}`
      )
      if (params.disableClosureNotification != null)
        url.searchParams.set(
          'disableClosureNotification',
          String(params.disableClosureNotification)
        )
      return url.toString()
    },
    method: 'PATCH',
    headers: (params) => buildZohoDeskHeaders(params),
    body: (params) => {
      const body = omitUnset({
        contactId: params.ticketContactId,
        contact: parseZohoDeskJson(params.contact, 'contact', 'object'),
        productId: params.productId,
        uploads: parseZohoDeskJson(params.uploads, 'uploads', 'array'),
        email: params.email,
        phone: params.phone,
        language: params.language,
        channel: params.channel,
        webUrl: params.webUrl,
        sharedDepartments: parseZohoDeskJson(
          params.sharedDepartments,
          'sharedDepartments',
          'array'
        ),
        teamId: params.teamId,
        secondaryContacts: parseZohoDeskJson(
          params.secondaryContacts,
          'secondaryContacts',
          'array'
        ),
        entitySkills: parseZohoDeskJson(params.entitySkills, 'entitySkills', 'array'),

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
        cf: parseZohoDeskJson(params.customFields, 'customFields', 'object'),
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
    const data = await readZohoDeskResponse(response)
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
