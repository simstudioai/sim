import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
  type MailtrapContactListResult,
  type MailtrapCreateContactListParams,
} from '@/tools/mailtrap/types'
import { expectContactList, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapCreateContactListTool: ToolConfig<
  MailtrapCreateContactListParams,
  MailtrapContactListResult
> = {
  id: 'mailtrap_create_contact_list',
  name: 'Mailtrap Create Contact List',
  description: 'Create a new contact list in the Mailtrap account',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with contacts access',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the contact list (max 255 characters)',
    },
  },

  request: {
    url: 'https://mailtrap.io/api/contacts/lists',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiToken}`,
    }),
    body: (params) => ({ name: params.name.trim() }),
  },

  transformResponse: async (response): Promise<MailtrapContactListResult> => {
    const data = await readJsonBody(response)
    return {
      success: true,
      output: { list: expectContactList(data) },
    }
  },

  outputs: {
    list: {
      type: 'object',
      description: 'The created contact list',
      properties: MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
    },
  },
}
