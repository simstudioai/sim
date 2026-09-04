import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
  type MailtrapCreateContactParams,
  type MailtrapCreateContactResult,
} from '@/tools/mailtrap/types'
import { mapContact, parseIdList, parseJsonRecord, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapCreateContactTool: ToolConfig<
  MailtrapCreateContactParams,
  MailtrapCreateContactResult
> = {
  id: 'mailtrap_create_contact',
  name: 'Mailtrap Create Contact',
  description: 'Create a new contact in Mailtrap with optional custom fields and list membership',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with contacts access',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the contact',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Object of contact field values keyed by merge tag (e.g. {"first_name": "John"})',
    },
    listIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated contact list ids to add the contact to',
    },
  },

  request: {
    url: 'https://mailtrap.io/api/contacts',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiToken}`,
    }),
    body: (params) => {
      const contact: Record<string, unknown> = { email: params.email.trim() }

      const fields = parseJsonRecord(params.fields, 'fields')
      if (fields) contact.fields = fields

      const listIds = parseIdList(params.listIds)
      if (listIds.length > 0) contact.list_ids = listIds

      return { contact }
    },
  },

  transformResponse: async (response): Promise<MailtrapCreateContactResult> => {
    const data = await readJsonBody(response)
    return {
      success: true,
      output: {
        contact: mapContact(data.data),
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The created contact',
      properties: MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
