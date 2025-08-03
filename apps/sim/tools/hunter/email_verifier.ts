import type { HunterEmailVerifierParams, HunterEmailVerifierResponse } from '@/tools/hunter/types'
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
      isInternalRoute: false,
      headers: () => ({
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        // Extract specific error message from Hunter.io API
        const errorMessage =
          data.errors?.[0]?.details ||
          data.message ||
          `HTTP ${response.status}: Failed to verify email`
        throw new Error(errorMessage)
      }

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

    transformError: (error) => {
      if (error instanceof Error) {
        // Return the exact error message from the API
        return error.message
      }
      return 'An unexpected error occurred while verifying email'
    },
  }
