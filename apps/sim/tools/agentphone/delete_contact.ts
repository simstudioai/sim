import type {
  AgentPhoneDeleteContactParams,
  AgentPhoneDeleteContactResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneDeleteContactTool: ToolConfig<
  AgentPhoneDeleteContactParams,
  AgentPhoneDeleteContactResult
> = {
  id: 'agentphone_delete_contact',
  name: 'Delete Contact',
  description: 'Delete a contact by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/contacts/${params.contactId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params): Promise<AgentPhoneDeleteContactResult> => {
    const contactId = params?.contactId?.trim() ?? ''

    if (!response.ok) {
      let errorMessage = 'Failed to delete contact'
      try {
        const data = await response.json()
        errorMessage = data?.detail?.[0]?.msg ?? data?.message ?? errorMessage
      } catch {
        // Response body may be empty; ignore parse failures.
      }
      return {
        success: false,
        error: errorMessage,
        output: { id: contactId, deleted: false },
      }
    }

    return {
      success: true,
      output: { id: contactId, deleted: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted contact' },
    deleted: { type: 'boolean', description: 'Whether the contact was deleted successfully' },
  },
}
