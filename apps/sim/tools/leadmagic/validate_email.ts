import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicValidateEmailParams,
  LeadMagicValidateEmailResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const validateEmailTool: ToolConfig<
  LeadMagicValidateEmailParams,
  LeadMagicValidateEmailResponse
> = {
  id: 'leadmagic_validate_email',
  name: 'LeadMagic Validate Email',
  description:
    'Verify an email address for deliverability. Charges 0.25 credits for definitive SMTP results (valid/invalid); unknown and RFC-invalid results are free.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicValidateEmailParams>((_params, output) => {
    // 0.25 credits for valid or SMTP-verified-invalid; free for unknown/syntax failures.
    // We use the API-reported credits_consumed field.
    // Source: https://leadmagic.io/docs/v1/reference/email-validation
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : 0
  }),

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to validate (e.g., john@example.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/email-validation',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ email: params.email }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        (errorData as Record<string, string>).message ||
          `LeadMagic API error: ${response.status} ${response.statusText}`
      )
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        email: data.email ?? '',
        email_status: data.email_status ?? '',
        is_domain_catch_all: data.is_domain_catch_all ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
        mx_record: data.mx_record ?? null,
        mx_provider: data.mx_provider ?? null,
        mx_gateway: data.mx_gateway ?? null,
        mx_security_gateway: data.mx_security_gateway ?? null,
        company_name: data.company_name ?? null,
        company_industry: data.company_industry ?? null,
        company_size: data.company_size ?? null,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'The validated email address' },
    email_status: {
      type: 'string',
      description: 'Validation result: valid, invalid, or unknown',
    },
    is_domain_catch_all: {
      type: 'boolean',
      description: 'Whether the domain accepts all emails (catch-all)',
      optional: true,
    },
    credits_consumed: {
      type: 'number',
      description: 'Credits charged for this request (0.25 for definitive results)',
    },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
    mx_record: { type: 'string', description: 'MX record for the domain', optional: true },
    mx_provider: {
      type: 'string',
      description: 'Email provider (e.g., Google, Microsoft)',
      optional: true,
    },
    mx_gateway: {
      type: 'string',
      description: 'MX gateway for the domain',
      optional: true,
    },
    mx_security_gateway: {
      type: 'boolean',
      description: 'Whether the domain uses a security gateway',
      optional: true,
    },
    company_name: {
      type: 'string',
      description: 'Company name associated with the email domain',
      optional: true,
    },
    company_industry: { type: 'string', description: 'Industry of the company', optional: true },
    company_size: { type: 'string', description: 'Company size range', optional: true },
  },
}
