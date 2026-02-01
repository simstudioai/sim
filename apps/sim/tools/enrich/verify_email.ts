import type { EnrichVerifyEmailParams, EnrichVerifyEmailResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const verifyEmailTool: ToolConfig<EnrichVerifyEmailParams, EnrichVerifyEmailResponse> = {
  id: 'enrich_verify_email',
  name: 'Enrich Verify Email',
  description:
    'Verify an email address for deliverability, including catch-all detection and provider identification.',
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
      description: 'Email address to verify (e.g., john.doe@example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/verify-email')
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

    return {
      success: true,
      output: {
        email: data.email ?? '',
        status: data.status ?? '',
        result: data.result ?? '',
        confidenceScore: data.confidenceScore ?? 0,
        smtpProvider: data.smtpProvider ?? null,
        mailDisposable: data.mailDisposable ?? false,
        mailAcceptAll: data.mailAcceptAll ?? false,
        free: data.free ?? false,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Email address verified',
    },
    status: {
      type: 'string',
      description: 'Verification status',
    },
    result: {
      type: 'string',
      description: 'Deliverability result (deliverable, undeliverable, etc.)',
    },
    confidenceScore: {
      type: 'number',
      description: 'Confidence score (0-100)',
    },
    smtpProvider: {
      type: 'string',
      description: 'Email service provider (e.g., Google, Microsoft)',
      optional: true,
    },
    mailDisposable: {
      type: 'boolean',
      description: 'Whether the email is from a disposable provider',
    },
    mailAcceptAll: {
      type: 'boolean',
      description: 'Whether the domain is a catch-all domain',
    },
    free: {
      type: 'boolean',
      description: 'Whether the email uses a free email service',
    },
  },
}
