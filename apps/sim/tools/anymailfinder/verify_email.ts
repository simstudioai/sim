import {
  ANYMAILFINDER_API_BASE_URL,
  anymailFinderError,
  anymailFinderHeaders,
  anymailFinderHosting,
} from '@/tools/anymailfinder/hosting'
import type {
  AnymailFinderVerifyEmailParams,
  AnymailFinderVerifyEmailResponse,
} from '@/tools/anymailfinder/types'
import type { ToolConfig } from '@/tools/types'

export const verifyEmailTool: ToolConfig<
  AnymailFinderVerifyEmailParams,
  AnymailFinderVerifyEmailResponse
> = {
  id: 'anymailfinder_verify_email',
  name: 'Anymail Finder Verify Email',
  description:
    'Check whether an email address exists and can receive mail, including on catch-all domains. Charges 0.2 credits per check whatever the outcome; repeats within 30 days are free.',
  version: '1.0.0',

  hosting: anymailFinderHosting<AnymailFinderVerifyEmailParams>(),

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to verify (e.g., john@example.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Anymail Finder API Key',
    },
  },

  request: {
    url: `${ANYMAILFINDER_API_BASE_URL}/verify-email`,
    method: 'POST',
    headers: (params) => anymailFinderHeaders(params.apiKey),
    body: (params) => ({ email: params.email.trim() }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await anymailFinderError(response),
        output: {
          email_status: 'risky' as const,
          mx_domain: null,
          mx_host: null,
          credits_charged: 0,
        },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        email_status: data.email_status ?? 'risky',
        mx_domain: data.mx_domain ?? null,
        mx_host: data.mx_host ?? null,
        // Passed through as-is: hosting.getCost refuses to bill a response without it.
        credits_charged: data.credits_charged,
      },
    }
  },

  outputs: {
    email_status: {
      type: 'string',
      description:
        'valid (deliverable), invalid (does not exist or does not accept mail) or risky (could not be determined)',
    },
    mx_domain: {
      type: 'string',
      description: 'Mail provider of the domain (e.g., google.com, outlook.com)',
      optional: true,
    },
    mx_host: { type: 'string', description: 'Primary MX hostname of the domain', optional: true },
    credits_charged: {
      type: 'number',
      description: 'Credits charged for this call (0.2, or 0 on a 30-day repeat)',
    },
  },
}
