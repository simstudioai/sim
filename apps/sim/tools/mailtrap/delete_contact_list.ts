import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MailtrapDeleteContactListParams,
  MailtrapDeleteContactListResult,
} from '@/tools/mailtrap/types'
import type { ToolConfig } from '@/tools/types'

export const mailtrapDeleteContactListTool: ToolConfig<
  MailtrapDeleteContactListParams,
  MailtrapDeleteContactListResult
> = {
  id: 'mailtrap_delete_contact_list',
  name: 'Mailtrap Delete Contact List',
  description: 'Delete a Mailtrap contact list by its id',
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
      description: 'Id of the contact list to delete',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/lists/${encodeURIComponent(params.listId.trim())}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (): Promise<MailtrapDeleteContactListResult> => ({
    success: true,
    output: {
      success: true,
      deleted: true,
    },
  }),

  outputs: {
    success: { type: 'boolean', description: 'Whether the request succeeded' },
    deleted: { type: 'boolean', description: 'Whether the contact list was deleted' },
  },
}
