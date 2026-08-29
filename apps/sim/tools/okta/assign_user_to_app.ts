import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAppUser,
  OktaAssignUserToAppParams,
  OktaAssignUserToAppResponse,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaAssignUserToApp')

export const oktaAssignUserToAppTool: ToolConfig<
  OktaAssignUserToAppParams,
  OktaAssignUserToAppResponse
> = {
  id: 'okta_assign_user_to_app',
  name: 'Assign User to Application in Okta',
  description:
    'Assign a user to an Okta application, granting them access to it. Applications that require credentials also need the username the user signs in with.',
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
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application ID to assign the user to',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Okta user ID to assign',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignment scope: USER for a direct assignment, or GROUP',
    },
    appUserName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Username the user signs in to the application with. Required by applications that store credentials',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/apps/${safeUrlPathSegment(params.appId, 'appId')}/users`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { id: params.userId }
      if (params.scope) body.scope = params.scope
      if (params.appUserName) body.credentials = { userName: params.appUserName }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to assign user to application in Okta')
    }

    const appUser: OktaAppUser = await response.json()

    return {
      success: true,
      output: {
        id: appUser.id,
        externalId: appUser.externalId ?? null,
        created: appUser.created,
        lastUpdated: appUser.lastUpdated,
        scope: appUser.scope,
        status: appUser.status,
        statusChanged: appUser.statusChanged ?? null,
        passwordChanged: appUser.passwordChanged ?? null,
        syncState: appUser.syncState ?? null,
        lastSync: appUser.lastSync ?? null,
        userName: appUser.credentials?.userName ?? null,
        profile: appUser.profile ?? null,
        assigned: true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Okta user ID that was assigned' },
    externalId: {
      type: 'string',
      description: 'ID of the user in the downstream application',
      optional: true,
    },
    created: { type: 'string', description: 'Assignment creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    scope: { type: 'string', description: 'Assignment scope (USER or GROUP)' },
    status: { type: 'string', description: 'Assignment status' },
    statusChanged: { type: 'string', description: 'Status change timestamp', optional: true },
    passwordChanged: {
      type: 'string',
      description: 'App password change timestamp',
      optional: true,
    },
    syncState: { type: 'string', description: 'Provisioning sync state', optional: true },
    lastSync: { type: 'string', description: 'Last provisioning sync', optional: true },
    userName: {
      type: 'string',
      description: 'Username the user signs in to the application with',
      optional: true,
    },
    profile: {
      type: 'json',
      description: 'App-specific profile attributes, whose shape is set by the app schema',
      optional: true,
    },
    assigned: { type: 'boolean', description: 'Whether the user was assigned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
