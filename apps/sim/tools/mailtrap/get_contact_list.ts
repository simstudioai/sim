import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
  type MailtrapContactListResult,
  type MailtrapGetContactListParams,
} from '@/tools/mailtrap/types'
import { expectContactList, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapGetContactListTool: ToolConfig<
  MailtrapGetContactListParams,
  MailtrapContactListResult
> = {
  id: 'mailtrap_get_contact_list',
  name: 'Mailtrap Get Contact List',
  description: 'Retrieve a single Mailtrap contact list by its id',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with contacts access',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Id of the contact list',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/lists/${encodeURIComponent(params.listId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
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
      description: 'The requested contact list',
      properties: MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
    },
  },
}
