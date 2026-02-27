import type { DeleteContactParams, DeleteContactResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

export const resendDeleteContactTool: ToolConfig<DeleteContactParams, DeleteContactResult> = {
  id: 'resend_delete_contact',
  name: 'Delete Contact',
  description: 'Delete a contact from Resend by ID or email',
  version: '1.0.0',

  params: {
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The contact ID or email address to delete',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: DeleteContactParams) =>
      `https://api.resend.com/contacts/${encodeURIComponent(params.contactId)}`,
    method: 'DELETE',
    headers: (params: DeleteContactParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<DeleteContactResult> => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.contact || data.id || '',
        deleted: data.deleted ?? true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted contact ID' },
    deleted: { type: 'boolean', description: 'Whether the contact was successfully deleted' },
  },
}
