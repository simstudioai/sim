import type { LoopsDeleteContactParams, LoopsDeleteContactResponse } from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsDeleteContactTool: ToolConfig<
  LoopsDeleteContactParams,
  LoopsDeleteContactResponse
> = {
  id: 'loops_delete_contact',
  name: 'Loops Delete Contact',
  description:
    'Delete a contact from Loops by email address or userId. At least one identifier must be provided.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The email address of the contact to delete (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The userId of the contact to delete (at least one of email or userId is required)',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/contacts/delete',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to delete a contact')
      }
      const body: Record<string, unknown> = {}
      if (params.email) body.email = params.email
      if (params.userId) body.userId = params.userId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
          message: data.message ?? 'Failed to delete contact',
        },
        error: data.message ?? 'Failed to delete contact',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: data.message ?? 'Contact deleted.',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the contact was deleted successfully' },
    message: { type: 'string', description: 'Status message from the API' },
  },
}
