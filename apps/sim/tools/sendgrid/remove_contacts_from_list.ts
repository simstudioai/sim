import type { RemoveContactsFromListParams } from '@/tools/sendgrid/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridRemoveContactsFromListTool: ToolConfig<
  RemoveContactsFromListParams,
  ToolResponse
> = {
  id: 'sendgrid_remove_contacts_from_list',
  name: 'SendGrid Remove Contacts from List',
  description: 'Remove contacts from a specific list in SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List ID',
    },
    contactIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated contact IDs to remove from the list',
    },
  },

  request: {
    url: (params) => {
      const contactIds = params.contactIds
        .split(',')
        .map((id) => id.trim())
        .join(',')
      return `https://api.sendgrid.com/v3/marketing/lists/${params.listId}/contacts?contact_ids=${encodeURIComponent(contactIds)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to remove contacts from list')
    }

    const data = (await response.json()) as { job_id?: string }

    return {
      success: true,
      output: {
        jobId: data.job_id,
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job ID for the request' },
  },
}
