import type {
  LoopsRemoveContactSuppressionParams,
  LoopsRemoveContactSuppressionResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsRemoveContactSuppressionTool: ToolConfig<
  LoopsRemoveContactSuppressionParams,
  LoopsRemoveContactSuppressionResponse
> = {
  id: 'loops_remove_contact_suppression',
  name: 'Loops Remove Contact Suppression',
  description:
    'Remove a Loops contact from the suppression list by email address or userId, allowing them to receive emails again. Subject to a team removal quota.',
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
        'The contact email address to remove from suppression (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The contact userId to remove from suppression (at least one of email or userId is required)',
    },
  },

  request: {
    url: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to remove suppression')
      }
      const base = 'https://app.loops.so/api/v1/contacts/suppression'
      if (params.email) return `${base}?email=${encodeURIComponent(params.email.trim())}`
      return `${base}?userId=${encodeURIComponent(params.userId!.trim())}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
          message: data.message ?? 'Failed to remove contact suppression',
          removalQuotaLimit: (data.removalQuota?.limit as number) ?? null,
          removalQuotaRemaining: (data.removalQuota?.remaining as number) ?? null,
        },
        error: data.message ?? 'Failed to remove contact suppression',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: data.message ?? 'Contact removed from suppression list.',
        removalQuotaLimit: (data.removalQuota?.limit as number) ?? null,
        removalQuotaRemaining: (data.removalQuota?.remaining as number) ?? null,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the contact was removed from suppression successfully',
    },
    message: { type: 'string', description: 'Status message from the API', optional: true },
    removalQuotaLimit: {
      type: 'number',
      description: 'Total suppression-removal quota for the team',
      optional: true,
    },
    removalQuotaRemaining: {
      type: 'number',
      description: 'Remaining suppression-removal quota for the team',
      optional: true,
    },
  },
}
