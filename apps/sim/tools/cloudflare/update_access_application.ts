import type {
  CloudflareAccessApplicationResponse,
  CloudflareUpdateAccessApplicationParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyAccessApplication,
  mapAccessApplication,
  parseCsvParam,
  parseJsonArrayParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const updateAccessApplicationTool: ToolConfig<
  CloudflareUpdateAccessApplicationParams,
  CloudflareAccessApplicationResponse
> = {
  id: 'cloudflare_update_access_application',
  name: 'Cloudflare Update Access Application',
  description:
    'Updates a Cloudflare Access (Zero Trust) application. This replaces the application definition rather than merging it, so send every field the application should keep — anything you omit reverts to its default, which can widen or break access. Read the current configuration with "Get Access Application" first. Requires an API token with Account Access: Apps and Policies Edit.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access applications are account-scoped',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Access application ID to update',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Application type: self_hosted, saas, ssh, vnc, app_launcher, warp, biso, bookmark, dash_sso, infrastructure, rdp, mcp, mcp_portal, or proxy_endpoint',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The primary hostname and path secured by Access. Required for the self_hosted, ssh, vnc, rdp, and bookmark types; the saas, app_launcher, warp, biso, dash_sso, infrastructure, mcp, mcp_portal, and proxy_endpoint types do not accept it',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Friendly name shown in the dashboard and App Launcher',
    },
    sessionDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How long an Access session stays valid, e.g. 24h or 30m',
    },
    allowedIdps: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated identity provider IDs users may authenticate with',
    },
    appLauncherVisible: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the application is shown in the App Launcher',
    },
    autoRedirectToIdentity: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether users skip the identity provider picker',
    },
    customDenyMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message shown to users who are denied access',
    },
    customDenyUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL denied users are redirected to',
    },
    logoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Logo image URL shown in the dashboard and App Launcher',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag names categorizing the application',
    },
    policies: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of policies to attach. Entries may be reusable policy IDs or inline policy objects',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/apps/${params.appId.trim()}`,
    method: 'PUT',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { type: params.type }
      /**
       * `domain` exists only on the self_hosted, ssh, vnc, rdp, and bookmark
       * request variants; the saas, app_launcher, warp, biso, dash_sso,
       * infrastructure, mcp, mcp_portal, and proxy_endpoint variants have no
       * such field, so sending a blank one makes those app types unbuildable.
       */
      if (params.domain) body.domain = params.domain
      if (params.name) body.name = params.name
      if (params.sessionDuration) body.session_duration = params.sessionDuration

      const allowedIdps = parseCsvParam(params.allowedIdps)
      if (allowedIdps) body.allowed_idps = allowedIdps

      if (params.appLauncherVisible !== undefined) {
        body.app_launcher_visible = params.appLauncherVisible
      }
      if (params.autoRedirectToIdentity !== undefined) {
        body.auto_redirect_to_identity = params.autoRedirectToIdentity
      }
      if (params.customDenyMessage) body.custom_deny_message = params.customDenyMessage
      if (params.customDenyUrl) body.custom_deny_url = params.customDenyUrl
      if (params.logoUrl) body.logo_url = params.logoUrl

      const tags = parseCsvParam(params.tags)
      if (tags) body.tags = tags

      const policies = parseJsonArrayParam(params.policies, 'Policies')
      if (policies) body.policies = policies

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyAccessApplication(),
        error: cloudflareErrorMessage(data, 'Failed to update Access application'),
      }
    }

    return { success: true, output: mapAccessApplication(data.result) }
  },

  outputs: {
    id: { type: 'string', description: 'Access application identifier' },
    name: { type: 'string', description: 'Application name', optional: true },
    domain: {
      type: 'string',
      description: 'Primary hostname and path secured by Access',
      optional: true,
    },
    type: { type: 'string', description: 'Application type', optional: true },
    aud: { type: 'string', description: 'Audience tag used to verify Access JWTs', optional: true },
    session_duration: {
      type: 'string',
      description: 'How long an Access session stays valid',
      optional: true,
    },
    allowed_idps: {
      type: 'array',
      description: 'Identity provider IDs users may authenticate with',
      items: { type: 'string', description: 'Identity provider ID' },
      optional: true,
    },
    app_launcher_visible: {
      type: 'boolean',
      description: 'Whether the app appears in the App Launcher',
      optional: true,
    },
    auto_redirect_to_identity: {
      type: 'boolean',
      description: 'Whether users skip the identity provider picker',
      optional: true,
    },
    custom_deny_message: {
      type: 'string',
      description: 'Message shown when access is denied',
      optional: true,
    },
    custom_deny_url: {
      type: 'string',
      description: 'URL users are redirected to when access is denied',
      optional: true,
    },
    logo_url: { type: 'string', description: 'Logo image URL', optional: true },
    self_hosted_domains: {
      type: 'array',
      description: 'Additional hostnames and paths secured by the application',
      items: { type: 'string', description: 'Hostname and path' },
      optional: true,
    },
    destinations: {
      type: 'json',
      description: 'Public and private destinations secured by the application',
      optional: true,
    },
    tags: {
      type: 'array',
      description: 'Tags categorizing the application',
      items: { type: 'string', description: 'Tag name' },
      optional: true,
    },
    policies: {
      type: 'json',
      description: 'Access policies attached to the application',
      optional: true,
    },
  },
}
