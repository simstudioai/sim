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
  parseJsonObjectParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const updateAccessApplicationTool: ToolConfig<
  CloudflareUpdateAccessApplicationParams,
  CloudflareAccessApplicationResponse
> = {
  id: 'cloudflare_update_access_application',
  name: 'Cloudflare Update Access Application',
  description:
    'Updates a Cloudflare Access (Zero Trust) application. Cloudflare does not document merge behavior for this PUT, so treat it as a replace: send every field the application should keep, because an omitted field may revert to its default and widen or break access. Read the current configuration with "Get Access Application" first. Requires an API token with Account Access: Apps and Policies Edit.',
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
        'Application type: self_hosted, saas, ssh, vnc, app_launcher, warp, biso, bookmark, infrastructure, rdp, mcp, mcp_portal, or proxy_endpoint. dash_sso has no request variant and cannot be written through the API',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The primary hostname and path secured by Access. Required for the self_hosted, ssh, vnc, and rdp types; optional for bookmark and mcp_portal; read-only for app_launcher, warp, biso, and proxy_endpoint; and absent from the saas, infrastructure, and mcp variants',
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
    saasApp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON SaaS configuration, required for the saas type and rejected on every other type. SAML, e.g. { "auth_type": "saml", "consumer_service_url": "https://example.com/acs", "sp_entity_id": "https://example.com" }; OIDC, e.g. { "auth_type": "oidc", "client_id": "...", "redirect_uris": [ "https://example.com/callback" ] }',
    },
    targetCriteria: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of infrastructure target criteria, required for the infrastructure and rdp types and rejected on every other type, e.g. [{"port":22,"protocol":"SSH","target_attributes":{"hostname":["production"]}}]',
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
       * `domain` is writable only on the self_hosted, ssh, vnc, rdp, bookmark,
       * and mcp_portal request variants — required on the first four — read-only
       * on app_launcher, warp, biso, and proxy_endpoint, and absent from saas,
       * infrastructure, and mcp. Sending a blank one makes those types
       * unbuildable, so it is only forwarded when set.
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

      const saasApp = parseJsonObjectParam(params.saasApp, 'SaaS Application')
      if (saasApp) body.saas_app = saasApp

      const targetCriteria = parseJsonArrayParam(params.targetCriteria, 'Target Criteria')
      if (targetCriteria) body.target_criteria = targetCriteria

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
      description:
        'Additional hostnames and paths secured by the application. Cloudflare deprecated this field in favour of destinations, which is the one to read on a current application',
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
