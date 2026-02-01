import type {
  EnrichDisposableEmailCheckParams,
  EnrichDisposableEmailCheckResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const disposableEmailCheckTool: ToolConfig<
  EnrichDisposableEmailCheckParams,
  EnrichDisposableEmailCheckResponse
> = {
  id: 'enrich_disposable_email_check',
  name: 'Enrich Disposable Email Check',
  description:
    'Check if an email address is from a disposable or temporary email provider. Returns a score and validation details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to check (e.g., john.doe@example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/disposable-email-check')
      url.searchParams.append('email', params.email.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const emailData = data.data ?? {}

    return {
      success: true,
      output: {
        email: emailData.email ?? '',
        score: emailData.score ?? 0,
        testsPassed: emailData.tests_passed ?? '0/0',
        passed: emailData.passed ?? false,
        reason: emailData.reason ?? null,
        mailServerIp: emailData.mail_server_ip ?? null,
        mxRecords: emailData.mx_records ?? [],
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Email address checked',
    },
    score: {
      type: 'number',
      description: 'Validation score (0-100)',
    },
    testsPassed: {
      type: 'string',
      description: 'Number of tests passed (e.g., "3/3")',
    },
    passed: {
      type: 'boolean',
      description: 'Whether the email passed all validation tests',
    },
    reason: {
      type: 'string',
      description: 'Reason for failure if email did not pass',
      optional: true,
    },
    mailServerIp: {
      type: 'string',
      description: 'Mail server IP address',
      optional: true,
    },
    mxRecords: {
      type: 'array',
      description: 'MX records for the domain',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'MX record host' },
          pref: { type: 'number', description: 'MX record preference' },
        },
      },
    },
  },
}
