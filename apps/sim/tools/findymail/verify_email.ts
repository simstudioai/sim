import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailVerifyEmailParams,
  FindymailVerifyEmailResponse,
} from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const verifyEmailTool: ToolConfig<FindymailVerifyEmailParams, FindymailVerifyEmailResponse> =
  {
    id: 'findymail_verify_email',
    name: 'Findymail Verify Email',
    description: 'Verifies the deliverability of an email address. Uses one verifier credit.',
    version: '1.0.0',

    hosting: findymailHosting<FindymailVerifyEmailParams>(() => {
      // Each verification consumes one verifier credit, billed at the finder-credit rate.
      return 1
    }),

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
        description: 'Findymail API Key',
      },
    },

    request: {
      url: 'https://app.findymail.com/api/verify',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => ({ email: params.email }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error:
            (errorData as Record<string, string>).message ||
            (errorData as Record<string, string>).error ||
            `Findymail API error: ${response.status} ${response.statusText}`,
          output: { email: '', verified: false, provider: null },
        }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          email: data.email ?? '',
          verified: data.verified ?? false,
          provider: data.provider ?? null,
        },
      }
    },

    outputs: {
      email: { type: 'string', description: 'The verified email address' },
      verified: { type: 'boolean', description: 'Whether the email is verified as deliverable' },
      provider: {
        type: 'string',
        description: 'Email service provider (e.g., Google, Microsoft)',
        optional: true,
      },
    },
  }
