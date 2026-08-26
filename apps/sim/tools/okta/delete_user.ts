import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaDeleteUserParams, OktaDeleteUserResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaDeleteUser')

export const oktaDeleteUserTool: ToolConfig<OktaDeleteUserParams, OktaDeleteUserResponse> = {
  id: 'okta_delete_user',
  name: 'Delete User from Okta',
  description:
    'Permanently delete a user from your Okta organization. Can only be performed on DEPROVISIONED users. If the user is active, this will first deactivate them and a second call is needed to delete.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to delete',
    },
    sendEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send deactivation email to admin (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const sendEmail = isOktaFlagEnabled(params.sendEmail)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}?sendEmail=${sendEmail}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to delete user from Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Deleted user ID' },
    deleted: {
      type: 'boolean',
      description:
        'Whether the delete request was accepted. An ACTIVE user is deactivated by the first call and needs a second call to actually be deleted.',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
