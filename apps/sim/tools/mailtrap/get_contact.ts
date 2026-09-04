import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
  type MailtrapGetContactParams,
  type MailtrapGetContactResult,
} from '@/tools/mailtrap/types'
import { mapContact, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapGetContactTool: ToolConfig<
  MailtrapGetContactParams,
  MailtrapGetContactResult
> = {
  id: 'mailtrap_get_contact',
  name: 'Mailtrap Get Contact',
  description: 'Retrieve a Mailtrap contact by its UUID or email address',
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
      description: 'Contact UUID or email address',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/${encodeURIComponent(params.contactIdentifier.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response): Promise<MailtrapGetContactResult> => {
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
      description: 'The requested contact',
      properties: MAILTRAP_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
