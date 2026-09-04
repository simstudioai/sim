import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MailtrapDeleteContactParams,
  MailtrapDeleteContactResult,
} from '@/tools/mailtrap/types'
import type { ToolConfig } from '@/tools/types'

export const mailtrapDeleteContactTool: ToolConfig<
  MailtrapDeleteContactParams,
  MailtrapDeleteContactResult
> = {
  id: 'mailtrap_delete_contact',
  name: 'Mailtrap Delete Contact',
  description: 'Delete a Mailtrap contact by its UUID or email address',
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
      description: 'Contact UUID or email address to delete',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/contacts/${encodeURIComponent(params.contactIdentifier.trim())}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (): Promise<MailtrapDeleteContactResult> => ({
    success: true,
    output: {
      success: true,
      deleted: true,
    },
  }),

  outputs: {
    success: { type: 'boolean', description: 'Whether the request succeeded' },
    deleted: { type: 'boolean', description: 'Whether the contact was deleted' },
  },
}
