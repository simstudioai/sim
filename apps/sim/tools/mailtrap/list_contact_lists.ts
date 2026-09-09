import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
  type MailtrapListContactListsParams,
  type MailtrapListContactListsResult,
} from '@/tools/mailtrap/types'
import { mapContactList, readJsonArray } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapListContactListsTool: ToolConfig<
  MailtrapListContactListsParams,
  MailtrapListContactListsResult
> = {
  id: 'mailtrap_list_contact_lists',
  name: 'Mailtrap List Contact Lists',
  description:
    'List every contact list in the Mailtrap account, optionally filtered by name prefix',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with contacts access',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive name prefix to filter the lists by',
    },
  },

  request: {
    url: (params) => {
      const base = 'https://mailtrap.io/api/contacts/lists'
      const search = params.search?.trim()
      return search ? `${base}?search=${encodeURIComponent(search)}` : base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response): Promise<MailtrapListContactListsResult> => {
    const lists = (await readJsonArray(response))
      .filter((entry) => !!entry && typeof entry === 'object')
      .map(mapContactList)

    return {
      success: true,
      output: { lists },
    }
  },

  outputs: {
    lists: {
      type: 'array',
      description: 'Contact lists in the account',
      items: {
        type: 'object',
        properties: MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
      },
    },
  },
}
