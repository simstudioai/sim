import type {
  LoopsCheckContactSuppressionParams,
  LoopsCheckContactSuppressionResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsCheckContactSuppressionTool: ToolConfig<
  LoopsCheckContactSuppressionParams,
  LoopsCheckContactSuppressionResponse
> = {
  id: 'loops_check_contact_suppression',
  name: 'Loops Check Contact Suppression',
  description:
    'Check whether a Loops contact is on the suppression list (bounced, complained, or unsubscribed) by email address or userId.',
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
        'The contact email address to check (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The contact userId to check (at least one of email or userId is required)',
    },
  },

  request: {
    url: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to check suppression status')
      }
      const base = 'https://app.loops.so/api/v1/contacts/suppression'
      if (params.email) return `${base}?email=${encodeURIComponent(params.email.trim())}`
      return `${base}?userId=${encodeURIComponent(params.userId!.trim())}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.isSuppressed == null) {
      return {
        success: false,
        output: {
          contactId: null,
          email: null,
          userId: null,
          isSuppressed: false,
          removalQuotaLimit: null,
          removalQuotaRemaining: null,
        },
        error: data.message ?? 'Failed to check contact suppression status',
      }
    }

    return {
      success: true,
      output: {
        contactId: (data.contact?.id as string) ?? null,
        email: (data.contact?.email as string) ?? null,
        userId: (data.contact?.userId as string) ?? null,
        isSuppressed: (data.isSuppressed as boolean) ?? false,
        removalQuotaLimit: (data.removalQuota?.limit as number) ?? null,
        removalQuotaRemaining: (data.removalQuota?.remaining as number) ?? null,
      },
    }
  },

  outputs: {
    contactId: { type: 'string', description: 'The Loops-assigned contact ID', optional: true },
    email: { type: 'string', description: 'The contact email address', optional: true },
    userId: { type: 'string', description: 'The contact userId', optional: true },
    isSuppressed: {
      type: 'boolean',
      description: 'Whether the contact is on the suppression list',
    },
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
