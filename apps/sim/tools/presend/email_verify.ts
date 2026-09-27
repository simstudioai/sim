import type { PresendEmailVerifyParams, PresendEmailVerifyResponse } from '@/tools/presend/types'
import type { ToolConfig } from '@/tools/types'

export const emailVerifyTool: ToolConfig<PresendEmailVerifyParams, PresendEmailVerifyResponse> = {
  id: 'presend_email_verify',
  name: 'Presend Email Verify',
  description:
    'Free, no-signup, no-key single-address email verification: syntax, MX record, disposable-domain, and role-account checks in one call.',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address to verify',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://presend.pages.dev/api/email-verify')
      url.searchParams.append('email', params.email)

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
        email: data?.email ?? '',
        valid: data?.valid ?? false,
        syntaxValid: data?.syntax_valid ?? false,
        domain: data?.domain ?? '',
        mxFound: data?.has_mx ?? false,
        mxCount: data?.mx_count ?? 0,
        disposable: data?.disposable ?? false,
        roleAccount: data?.role_account ?? false,
        reason: data?.reason ?? '',
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'The verified email address',
    },
    valid: {
      type: 'boolean',
      description: 'Whether the email address is valid overall',
    },
    syntaxValid: {
      type: 'boolean',
      description: 'Whether the email address is correctly formatted (RFC syntax)',
    },
    domain: {
      type: 'string',
      description: 'The domain part of the email address',
    },
    mxFound: {
      type: 'boolean',
      description: "Whether the domain's MX records were found",
    },
    mxCount: {
      type: 'number',
      description: 'Number of MX records found for the domain',
    },
    disposable: {
      type: 'boolean',
      description: 'Whether the email uses a disposable/temporary domain',
    },
    roleAccount: {
      type: 'boolean',
      description: 'Whether the address is a role account (e.g. info@, support@)',
    },
    reason: {
      type: 'string',
      description: 'Explanation when the address is invalid, otherwise null',
    },
  },
}
