import type { ToolConfig } from '@/tools/types'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskCreateTicketParams,
  ZohoDeskCreateTicketResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskCreateTicketTool: ToolConfig<
  ZohoDeskCreateTicketParams,
  ZohoDeskCreateTicketResponse
> = {
  id: 'zoho_desk_create_ticket',
  name: 'Zoho Desk Create Ticket',
  description: 'Create Ticket in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    productId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the product to associate the ticket',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the ticket',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subject of the ticket',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date of the ticket',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel through which the ticket is being created.',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language preference of the ticket',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Priority of the ticket Allowed values: Medium, High, Low, or a custom priority.',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the assignee',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email ID of the ticket',
    },
    subCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subcategory of the ticket',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom fields in the ticket JSON object.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the ticket',
    },
    classification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Classification type of the ticket Allowed values: Problem, Request, Question, or a custom classification.',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category of the ticket',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Status of the ticket. Note: This can be a system-defined or custom value that falls under one of the status types: OPEN, ON HOLD, or CLOSED.',
    },
    ticketContactId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing contact ID for the ticket. Provide ticketContactId or a contact object to create a new contact.',
    },
    departmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the department to associate the ticket',
    },
    contact: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New contact JSON: email or lastName is required; firstName is optional. Provide either this or ticketContactId.',
    },
    uploads: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      required: false,
      visibility: 'user-or-llm',
      description:
        'File attachments in the ticket. For more information, refer to the Uploads section JSON array.',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution notes of the ticket',
    },
    webUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to access the resource',
    },
    sharedDepartments: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      required: false,
      visibility: 'user-or-llm',
      description:
        'List of departments to which the ticket could be shared, along with the access privileges for each department JSON array.',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the team to assign the ticket',
    },
    secondaryContacts: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      maxItems: 20,
      required: false,
      visibility: 'user-or-llm',
      description: 'List of Secondary contacts JSON array.',
    },
    entitySkills: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      maxItems: 10,
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of up to 10 skill IDs, ordered from highest to lowest assignment priority.',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/tickets`
    },
    method: 'POST',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        productId: params.productId,
        phone: params.phone,
        subject: params.subject,
        dueDate: params.dueDate,
        channel: params.channel,
        language: params.language,
        priority: params.priority,
        assigneeId: params.assigneeId,
        email: params.email,
        subCategory: params.subCategory,
        cf: parseZohoDeskJson(params.customFields, 'customFields', 'object'),
        description: params.description,
        classification: params.classification,
        category: params.category,
        status: params.status,
        contactId: params.ticketContactId?.trim() || undefined,
        departmentId: params.departmentId,
        contact: parseZohoDeskJson(params.contact, 'contact', 'object'),
        uploads: parseZohoDeskJson(params.uploads, 'uploads', 'array'),
        resolution: params.resolution,
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
      })
      if (!body.contactId && !body.contact)
        throw new Error('Provide ticketContactId or a contact object.')
      if (body.contactId && body.contact)
        throw new Error('Provide either ticketContactId or contact, not both.')
      if (body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact)) {
        const contact = body.contact as Record<string, unknown>
        if (!contact.email && !contact.lastName)
          throw new Error('The contact object needs email or lastName.')
      }
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { ticket: projectZohoDeskResource(data, ZOHO_DESK_TICKET_PROPERTIES) },
    }
  },
  outputs: {
    ticket: { type: 'object', description: 'The ticket', properties: ZOHO_DESK_TICKET_PROPERTIES },
  },
}
