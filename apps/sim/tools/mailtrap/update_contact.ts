import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
  type MailtrapUpdateContactParams,
  type MailtrapUpdateContactResult,
} from '@/tools/mailtrap/types'
import {
  expectRecord,
  mapContact,
  parseIdList,
  parseJsonRecord,
  parseOptionalBoolean,
  readJsonBody,
} from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapUpdateContactTool: ToolConfig<
  MailtrapUpdateContactParams,
  MailtrapUpdateContactResult
> = {
  id: 'mailtrap_update_contact',
  name: 'Mailtrap Update Contact',
  description:
    'Update a Mailtrap contact by UUID or email. Can change fields, list membership, and subscription state; creates the contact when it does not exist yet.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with contacts access',
    },
    contactIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact UUID or email address to update',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the contact (required by the API, may equal the identifier)',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object of contact field values keyed by merge tag',
    },
    listIdsIncluded: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated contact list ids to add the contact to',
    },
    listIdsExcluded: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated contact list ids to remove the contact from',
    },
    unsubscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to unsubscribe the contact, false to resubscribe',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/${encodeURIComponent(params.contactIdentifier.trim())}`,
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiToken}`,
    }),
    body: (params) => {
      const contact: Record<string, unknown> = { email: params.email.trim() }

      const fields = parseJsonRecord(params.fields, 'fields')
      if (fields) contact.fields = fields

      const included = parseIdList(params.listIdsIncluded)
      if (included.length > 0) contact.list_ids_included = included

      const excluded = parseIdList(params.listIdsExcluded)
      if (excluded.length > 0) contact.list_ids_excluded = excluded

      const unsubscribed = parseOptionalBoolean(params.unsubscribed)
      if (unsubscribed !== undefined) contact.unsubscribed = unsubscribed

      return { contact }
    },
  },

  transformResponse: async (response): Promise<MailtrapUpdateContactResult> => {
    const data = await readJsonBody(response)
    return {
      success: true,
      output: {
        action: typeof data.action === 'string' ? data.action : '',
        contact: mapContact(expectRecord(data.data, 'the contact payload')),
      },
    }
  },

  outputs: {
    action: {
      type: 'string',
      description: '"created" when the contact did not exist, otherwise "updated"',
    },
    contact: {
      type: 'object',
      description: 'The contact after the update',
      properties: MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
