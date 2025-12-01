import type { DeleteContactParams } from '@/tools/sendgrid/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridDeleteContactsTool: ToolConfig<DeleteContactParams, ToolResponse> = {
  id: 'sendgrid_delete_contacts',
  name: 'SendGrid Delete Contacts',
  description: 'Delete one or more contacts from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    contactIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated contact IDs to delete',
    },
  },

  request: {
    url: (params) => {
      const ids = params.contactIds
        .split(',')
        .map((id) => id.trim())
        .join(',')
      return `https://api.sendgrid.com/v3/marketing/contacts?ids=${encodeURIComponent(ids)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to delete contacts')
    }

    const data = (await response.json()) as { job_id: string }

    return {
      success: true,
      output: {
        jobId: data.job_id,
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job ID for the deletion request' },
  },
}
