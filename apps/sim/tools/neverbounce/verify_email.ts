import { neverbounceHosting } from '@/tools/neverbounce/hosting'
import type {
  NeverBounceVerifyEmailParams,
  NeverBounceVerifyEmailResponse,
} from '@/tools/neverbounce/types'
import type { ToolConfig } from '@/tools/types'

/** Maps a NeverBounce `result` to the shared verification vocabulary. */
const STATUS_MAP: Record<string, string> = {
  valid: 'valid',
  invalid: 'invalid',
  catchall: 'catch_all',
  disposable: 'disposable',
  unknown: 'unknown',
}

export const verifyEmailTool: ToolConfig<
  NeverBounceVerifyEmailParams,
  NeverBounceVerifyEmailResponse
> = {
  id: 'neverbounce_verify_email',
  name: 'NeverBounce Verify Email',
  description: 'Verify the deliverability of an email address. Uses one verification credit.',
  version: '1.0.0',

  hosting: neverbounceHosting<NeverBounceVerifyEmailParams>(() => {
    // Each verification consumes one NeverBounce credit.
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
      description: 'NeverBounce API Key',
    },
  },

  request: {
    url: (params) =>
      `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(
        params.apiKey.trim()
      )}&email=${encodeURIComponent(params.email.trim())}&address_info=1`,
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response, params?: NeverBounceVerifyEmailParams) => {
    const data = await response.json().catch(() => ({}))
    // NeverBounce returns HTTP 200 for API-level errors; the envelope status
    // distinguishes a successful check from an auth/quota failure.
    if (!response.ok || data.status !== 'success') {
      return {
        success: false,
        error:
          (data as Record<string, string>).message ||
          `NeverBounce API error: ${response.status} ${response.statusText}`,
        output: { email: params?.email ?? '', status: '', deliverable: false },
      }
    }
    const result = String(data.result ?? '')
    const flags: string[] = Array.isArray(data.flags) ? data.flags : []
    return {
      success: true,
      output: {
        email: params?.email ?? '',
        status: STATUS_MAP[result] ?? result,
        deliverable: result === 'valid',
        roleAccount: flags.includes('role_account'),
        freeEmail: flags.includes('free_email_host'),
        didYouMean: data.suggested_correction ?? '',
        flags,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'The verified email address' },
    status: {
      type: 'string',
      description: 'Verification status (valid, invalid, catch_all, disposable, unknown)',
    },
    deliverable: {
      type: 'boolean',
      description: 'Whether the email is valid and safe to send',
    },
    roleAccount: {
      type: 'boolean',
      description: 'Whether the address is a role account (e.g., info@, sales@)',
      optional: true,
    },
    freeEmail: {
      type: 'boolean',
      description: 'Whether the address is on a free email provider',
      optional: true,
    },
    didYouMean: {
      type: 'string',
      description: 'Suggested correction for a likely typo',
      optional: true,
    },
    flags: {
      type: 'array',
      description: 'Raw NeverBounce flags for the address',
      optional: true,
    },
  },
}
