import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
  type MailtrapContactListResult,
  type MailtrapUpdateContactListParams,
} from '@/tools/mailtrap/types'
import { mapContactList, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapUpdateContactListTool: ToolConfig<
  MailtrapUpdateContactListParams,
  MailtrapContactListResult
> = {
  id: 'mailtrap_update_contact_list',
  name: 'Mailtrap Update Contact List',
  description: 'Rename an existing Mailtrap contact list',
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
      description: 'Id of the contact list to update',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the contact list (max 255 characters)',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/lists/${encodeURIComponent(params.listId.trim())}`,
    method: 'PATCH',
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
      output: { list: mapContactList(data) },
    }
  },

  outputs: {
    list: {
      type: 'object',
      description: 'The contact list after the update',
      properties: MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES,
    },
  },
}
