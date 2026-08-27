import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaApplication, OktaGetAppParams, OktaGetAppResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaGetApp')

export const oktaGetAppTool: ToolConfig<OktaGetAppParams, OktaGetAppResponse> = {
  id: 'okta_get_app',
  name: 'Get Application from Okta',
  description:
    'Retrieve a single Okta application by ID, including its sign-on mode, status, enabled provisioning features, and configuration objects.',
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
      description: 'Application ID to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/apps/${encodeURIComponent(params.appId.trim())}`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get application from Okta')
    }

    const app: OktaApplication = await response.json()

    return {
      success: true,
      output: {
        id: app.id,
        name: app.name,
        label: app.label,
        status: app.status,
        signOnMode: app.signOnMode,
        features: app.features ?? [],
        created: app.created,
        lastUpdated: app.lastUpdated,
        accessibility: app.accessibility ?? null,
        visibility: app.visibility ?? null,
        settings: app.settings ?? null,
        profile: app.profile ?? null,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Application ID' },
    name: { type: 'string', description: 'Application name (the app template key)' },
    label: { type: 'string', description: 'Application display label' },
    status: { type: 'string', description: 'Application status (ACTIVE, INACTIVE, DELETED)' },
    signOnMode: { type: 'string', description: 'Sign-on mode' },
    features: {
      type: 'array',
      description: 'Enabled provisioning features',
      items: { type: 'string', description: 'Feature name' },
    },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    accessibility: {
      type: 'json',
      description: 'Access settings for the app',
      optional: true,
      properties: {
        errorRedirectUrl: {
          type: 'string',
          description: 'Custom error page URL',
          optional: true,
        },
        loginRedirectUrl: {
          type: 'string',
          description: 'Custom login page URL',
          optional: true,
        },
        selfService: {
          type: 'boolean',
          description: 'Whether users can self-assign the app',
          optional: true,
        },
      },
    },
    visibility: {
      type: 'json',
      description: 'Visibility settings for the app',
      optional: true,
      properties: {
        appLinks: {
          type: 'json',
          description: 'Map of app link name to whether it appears on the End-User Dashboard',
          optional: true,
        },
        autoLaunch: {
          type: 'boolean',
          description: 'Signs in to the app automatically when the user signs in to Okta',
          optional: true,
        },
        autoSubmitToolbar: {
          type: 'boolean',
          description: 'Signs in automatically when the user lands on the sign-in page',
          optional: true,
        },
        hide: {
          type: 'json',
          description: 'Which end-user apps hide this app',
          optional: true,
          properties: {
            iOS: {
              type: 'boolean',
              description: 'Hidden in Okta Mobile',
              optional: true,
            },
            web: {
              type: 'boolean',
              description: 'Hidden on the Okta End-User Dashboard',
              optional: true,
            },
          },
        },
      },
    },
    settings: {
      type: 'json',
      description:
        'Application settings. Okta types these per app kind, so settings.app differs between a SAML, OIDC, bookmark, or SWA app',
      optional: true,
    },
    profile: {
      type: 'json',
      description:
        'Application profile attributes. Okta accepts any valid JSON schema here, so the shape is whatever the org configured',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
