import { millionverifierHosting } from '@/tools/millionverifier/hosting'
import type {
  MillionVerifierVerifyEmailParams,
  MillionVerifierVerifyEmailResponse,
} from '@/tools/millionverifier/types'
import type { ToolConfig } from '@/tools/types'

/** Maps a MillionVerifier `result` to the shared verification vocabulary. */
const STATUS_MAP: Record<string, string> = {
  ok: 'valid',
  invalid: 'invalid',
  catch_all: 'catch_all',
  disposable: 'disposable',
  unknown: 'unknown',
  unverified: 'unverified',
}

export const verifyEmailTool: ToolConfig<
  MillionVerifierVerifyEmailParams,
  MillionVerifierVerifyEmailResponse
> = {
  id: 'millionverifier_verify_email',
  name: 'MillionVerifier Verify Email',
  description: 'Verify the deliverability of an email address. Uses one verification credit.',
  version: '1.0.0',

  hosting: millionverifierHosting<MillionVerifierVerifyEmailParams>(() => {
    // Each verification consumes one MillionVerifier credit.
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
      description: 'MillionVerifier API Key',
    },
  },

  request: {
    url: (params) =>
      `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(
        params.apiKey.trim()
      )}&email=${encodeURIComponent(params.email.trim())}&timeout=10`,
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    const errorMessage =
      typeof data === 'object' && data !== null && typeof data.error === 'string' ? data.error : ''
    if (!response.ok || errorMessage.length > 0) {
      return {
        success: false,
        error:
          errorMessage || `MillionVerifier API error: ${response.status} ${response.statusText}`,
        output: { email: '', status: '', deliverable: false },
      }
    }
    const result = String(data.result ?? '')
    return {
      success: true,
      output: {
        email: data.email ?? '',
        status: STATUS_MAP[result] ?? result,
        deliverable: result === 'ok',
        freeEmail: data.free ?? false,
        roleAccount: data.role ?? false,
        didYouMean: data.didyoumean ?? '',
        subResult: data.subresult ?? '',
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'The verified email address' },
    status: {
      type: 'string',
      description:
        'Verification status (valid, invalid, catch_all, disposable, unknown, unverified)',
    },
    deliverable: {
      type: 'boolean',
      description: 'Whether the email is valid and safe to send',
    },
    freeEmail: {
      type: 'boolean',
      description: 'Whether the address is on a free email provider',
      optional: true,
    },
    roleAccount: {
      type: 'boolean',
      description: 'Whether the address is a role account (e.g., info@, sales@)',
      optional: true,
    },
    didYouMean: {
      type: 'string',
      description: 'Suggested correction for a likely typo',
      optional: true,
    },
    subResult: {
      type: 'string',
      description: 'Additional MillionVerifier classification detail',
      optional: true,
    },
  },
}
