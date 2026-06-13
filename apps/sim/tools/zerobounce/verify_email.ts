import type { ToolConfig } from '@/tools/types'
import { zerobounceHosting } from '@/tools/zerobounce/hosting'
import type {
  ZeroBounceVerifyEmailParams,
  ZeroBounceVerifyEmailResponse,
} from '@/tools/zerobounce/types'

export const verifyEmailTool: ToolConfig<
  ZeroBounceVerifyEmailParams,
  ZeroBounceVerifyEmailResponse
> = {
  id: 'zerobounce_verify_email',
  name: 'ZeroBounce Verify Email',
  description: 'Validate an email address deliverability in real time. Uses one validation credit.',
  version: '1.0.0',

  hosting: zerobounceHosting<ZeroBounceVerifyEmailParams>(() => 1),

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
      description: 'ZeroBounce API Key',
    },
  },

  request: {
    url: (params) =>
      `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(
        params.apiKey.trim()
      )}&email=${encodeURIComponent(params.email.trim())}&ip_address=`,
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).error ||
          `ZeroBounce API error: ${response.status} ${response.statusText}`,
        output: { email: '', status: '', deliverable: false },
      }
    }
    const data = await response.json().catch(() => ({}))
    if (data.error) {
      return {
        success: false,
        error: String(data.error),
        output: { email: '', status: '', deliverable: false },
      }
    }
    const rawStatus = String(data.status ?? '')
    // Normalize ZeroBounce's hyphenated 'catch-all' to the shared 'catch_all' vocabulary.
    const status = rawStatus === 'catch-all' ? 'catch_all' : rawStatus
    return {
      success: true,
      output: {
        email: data.address ?? '',
        status,
        deliverable: rawStatus === 'valid',
        subStatus: data.sub_status ?? '',
        freeEmail: data.free_email ?? false,
        didYouMean: data.did_you_mean ?? '',
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'The validated email address' },
    status: {
      type: 'string',
      description:
        'Validation status (valid, invalid, catch_all, unknown, spamtrap, abuse, do_not_mail)',
    },
    deliverable: {
      type: 'boolean',
      description: 'Whether the email is valid and safe to send',
    },
    subStatus: {
      type: 'string',
      description: 'Detailed sub-status from ZeroBounce',
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
  },
}
