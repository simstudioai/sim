import type { HunterEmailVerifierParams, HunterEmailVerifierResponse } from '@/tools/hunter/types'
import { SOURCES_OUTPUT } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const emailVerifierTool: ToolConfig<HunterEmailVerifierParams, HunterEmailVerifierResponse> =
  {
    id: 'hunter_email_verifier',
    name: 'Hunter Email Verifier',
    description:
      'Verifies the deliverability of an email address and provides detailed verification status.',
    version: '1.0.0',

    params: {
      email: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The email address to verify',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Hunter.io API Key',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://api.hunter.io/v2/email-verifier')
        url.searchParams.append('email', params.email)
        url.searchParams.append('api_key', params.apiKey)

        return url.toString()
      },
      method: 'GET',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          result: data.data?.result || 'unknown',
          score: data.data?.score || 0,
          email: data.data?.email || '',
          regexp: data.data?.regexp || false,
          gibberish: data.data?.gibberish || false,
          disposable: data.data?.disposable || false,
          webmail: data.data?.webmail || false,
          mx_records: data.data?.mx_records || false,
          smtp_server: data.data?.smtp_server || false,
          smtp_check: data.data?.smtp_check || false,
          accept_all: data.data?.accept_all || false,
          block: data.data?.block || false,
          status: data.data?.status || 'unknown',
          sources: data.data?.sources || [],
        },
      }
    },

    outputs: {
      result: {
        type: 'string',
        description: 'Deliverability result: deliverable, undeliverable, or risky',
      },
      score: {
        type: 'number',
        description:
          'Deliverability score (0-100). Webmail and disposable emails receive an arbitrary score of 50.',
      },
      email: {
        type: 'string',
        description: 'The verified email address',
      },
      regexp: {
        type: 'boolean',
        description: 'Whether the email passes regular expression validation',
      },
      gibberish: {
        type: 'boolean',
        description: 'Whether the email appears to be auto-generated (e.g., e65rc109q@company.com)',
      },
      disposable: {
        type: 'boolean',
        description: 'Whether the email is from a disposable email service',
      },
      webmail: {
        type: 'boolean',
        description: 'Whether the email is from a webmail provider (e.g., Gmail)',
      },
      mx_records: {
        type: 'boolean',
        description: 'Whether MX records exist for the domain',
      },
      smtp_server: {
        type: 'boolean',
        description: 'Whether connection to the SMTP server was successful',
      },
      smtp_check: {
        type: 'boolean',
        description: "Whether the email address doesn't bounce",
      },
      accept_all: {
        type: 'boolean',
        description: 'Whether the server accepts all email addresses (may cause false positives)',
      },
      block: {
        type: 'boolean',
        description:
          'Whether the domain is blocking verification (validity could not be determined)',
      },
      status: {
        type: 'string',
        description:
          'Verification status: valid, invalid, accept_all, webmail, disposable, unknown, or blocked',
      },
      sources: SOURCES_OUTPUT,
    },
  }
