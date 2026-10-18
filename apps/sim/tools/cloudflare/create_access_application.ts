import { isRecordLike } from '@sim/utils/object'
import { ACCESS_APPLICATION_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareAccessApplicationResponse,
  CloudflareCreateAccessApplicationParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  parseCsvParam,
  parseJsonArrayParam,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createAccessApplicationTool: ToolConfig<
  CloudflareCreateAccessApplicationParams,
  CloudflareAccessApplicationResponse
> = {
  id: 'cloudflare_create_access_application',
  name: 'Cloudflare Create Access Application',
  description:
    'Creates a Cloudflare Access (Zero Trust) application that puts an identity check in front of a hostname. Until at least one policy is attached the application denies everyone, so pair this with "Create Access Policy". Requires an API token with Account Access: Apps and Policies Edit.',
  version: '1.0.0',

  params: {
    destinations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. List of destinations secured by Access. This supersedes `self_hosted_domains` to allow for more flexibility in defining different types of domains. If `destinations` are provided, then `self_hosted_domains` will be ignored. Fields: overrides, type, uri, cidr, hostname, l4_protocol, port_range, vnet_id, mcp_server_id, worker_id.',
    },
    oauth_configuration: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Required for end_user applications. **Beta:** Optional configuration for managing an OAuth authorization flow controlled by Access. When set, Access will act as the OAuth authorization server for this application. Only compatible with OAuth clients that support [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) (Resource Indicators for OAuth 2.0). This feature is currently in beta. Fields: dynamic_client_registration, enabled, grant.',
    },
    self_hosted_domains: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. List of public domains that Access will secure. This field is deprecated in favor of `destinations` and will be supported until **November 21, 2025.** If `destinations` are provided, then `self_hosted_domains` will be ignored.',
    },
    user_populations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. Required for end_user applications. The single user population associated with this application.',
    },
    allow_authenticate_via_warp: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When set to true, users can authenticate to this application using their WARP session. When set to false this application will always require direct IdP authentication. This setting always overrides the organization setting for WARP authentication.',
    },
    allow_iframe: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enables loading application content in an iFrame.',
    },
    cors_headers: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. cors headers Fields: allow_all_headers, allow_all_methods, allow_all_origins, allow_credentials, allowed_headers, allowed_methods, allowed_origins, max_age.',
    },
    custom_non_identity_deny_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The custom URL a user is redirected to when they are denied access to the application when failing non-identity rules.',
    },
    custom_pages: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. The custom pages that will be displayed when applicable for this application',
    },
    eager_redirect_cookie_setting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Preemptively sets the Access session cookie on every hostname in a multi-hostname self-hosted application during the initial redirect chain, rather than setting it lazily on first visit. Defaults to true. Set to false to disable the eager redirect cookie behavior.',
    },
    enable_binding_cookie: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enables the binding cookie, which increases security against compromised authorization tokens and CSRF attacks.',
    },
    http_only_cookie_attribute: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enables the HttpOnly cookie attribute, which increases security against XSS attacks.',
    },
    mfa_config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Configures multi-factor authentication (MFA) settings. Fields: allowed_authenticators, mfa_disabled, session_duration.',
    },
    options_preflight_bypass: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Allows options preflight requests to bypass Access authentication and go directly to the origin. Cannot turn on if cors_headers is set.',
    },
    path_cookie_attribute: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Enables cookie paths to scope an application's JWT to the application path. If disabled, the JWT will scope to the hostname by default",
    },
    read_service_tokens_from_header: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Allows matching Access Service Tokens passed HTTP in a single header with this name. This works as an alternative to the (CF-Access-Client-Id, CF-Access-Client-Secret) pair of headers. The header value will be interpreted as a json object similar to: { "cf-access-client-id": "<CLIENT_ID>", "cf-access-client-secret": "<CLIENT_SECRET>" }',
    },
    same_site_cookie_attribute: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sets the SameSite cookie setting, which provides increased security against CSRF attacks.',
    },
    scim_config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Configuration for provisioning to this application via SCIM. This is currently in closed beta. Fields: authentication, deactivate_on_delete, enabled, idp_uid, mappings, remote_uri.',
    },
    service_auth_401_redirect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Returns a 401 status code when the request is blocked by a Service Auth policy.',
    },
    skip_interstitial: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enables automatic authentication through cloudflared.',
    },
    use_clientless_isolation_app_launcher_url: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Determines if users can access this application via a clientless browser isolation URL. This allows users to access private domains without connecting to Gateway. The option requires Clientless Browser Isolation to be set up with policies that allow users of this application.',
    },
    app_launcher_logo_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The image URL of the logo shown in the App Launcher header.',
    },
    bg_color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The background color of the App Launcher page.',
    },
    footer_links: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array. The links in the App Launcher footer. Fields: name, url.',
    },
    header_bg_color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The background color of the App Launcher header.',
    },
    landing_page_design: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. The design of the App Launcher landing page shown to users when they log in. Fields: button_color, button_text_color, image_url, message, title.',
    },
    skip_app_launcher_login_page: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Determines when to skip the App Launcher landing page.',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access applications are account-scoped',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Application type: self_hosted, end_user, saas, ssh, vnc, app_launcher, warp, biso, bookmark, infrastructure, rdp, mcp, mcp_portal, or proxy_endpoint. dash_sso has no request variant and cannot be created through the API',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The primary hostname and path secured by Access, e.g. internal.example.com or example.com/admin. Required for the self_hosted, ssh, vnc, and rdp types; optional for bookmark and mcp_portal; read-only for app_launcher, warp, biso, and proxy_endpoint; and absent from the saas, infrastructure, and mcp variants',
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
      description:
        'Comma-separated identity provider IDs users may authenticate with. Leave empty to allow all configured providers',
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
        'JSON array of policies to attach. Entries may be reusable policy IDs or inline policy objects, e.g. ["<POLICY_ID>"]',
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps`,
    method: 'POST',
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

      if (params.destinations !== undefined && params.destinations !== '')
        body.destinations = parseJsonArrayParam(params.destinations, 'destinations')
      if (params.oauth_configuration !== undefined && params.oauth_configuration !== '')
        body.oauth_configuration = parseJsonObjectParam(
          params.oauth_configuration,
          'oauth_configuration'
        )
      if (params.self_hosted_domains !== undefined && params.self_hosted_domains !== '')
        body.self_hosted_domains = parseJsonArrayParam(
          params.self_hosted_domains,
          'self_hosted_domains'
        )
      if (params.user_populations !== undefined && params.user_populations !== '')
        body.user_populations = parseJsonArrayParam(params.user_populations, 'user_populations')
      if (params.allow_authenticate_via_warp !== undefined)
        body.allow_authenticate_via_warp = params.allow_authenticate_via_warp
      if (params.allow_iframe !== undefined) body.allow_iframe = params.allow_iframe
      if (params.cors_headers !== undefined && params.cors_headers !== '')
        body.cors_headers = parseJsonObjectParam(params.cors_headers, 'cors_headers')
      if (
        params.custom_non_identity_deny_url !== undefined &&
        params.custom_non_identity_deny_url !== ''
      )
        body.custom_non_identity_deny_url = params.custom_non_identity_deny_url
      if (params.custom_pages !== undefined && params.custom_pages !== '')
        body.custom_pages = parseJsonArrayParam(params.custom_pages, 'custom_pages')
      if (params.eager_redirect_cookie_setting !== undefined)
        body.eager_redirect_cookie_setting = params.eager_redirect_cookie_setting
      if (params.enable_binding_cookie !== undefined)
        body.enable_binding_cookie = params.enable_binding_cookie
      if (params.http_only_cookie_attribute !== undefined)
        body.http_only_cookie_attribute = params.http_only_cookie_attribute
      if (params.mfa_config !== undefined && params.mfa_config !== '')
        body.mfa_config = parseJsonObjectParam(params.mfa_config, 'mfa_config')
      if (params.options_preflight_bypass !== undefined)
        body.options_preflight_bypass = params.options_preflight_bypass
      if (params.path_cookie_attribute !== undefined)
        body.path_cookie_attribute = params.path_cookie_attribute
      if (
        params.read_service_tokens_from_header !== undefined &&
        params.read_service_tokens_from_header !== ''
      )
        body.read_service_tokens_from_header = params.read_service_tokens_from_header
      if (
        params.same_site_cookie_attribute !== undefined &&
        params.same_site_cookie_attribute !== ''
      )
        body.same_site_cookie_attribute = params.same_site_cookie_attribute
      if (params.scim_config !== undefined && params.scim_config !== '')
        body.scim_config = parseJsonObjectParam(params.scim_config, 'scim_config')
      if (params.service_auth_401_redirect !== undefined)
        body.service_auth_401_redirect = params.service_auth_401_redirect
      if (params.skip_interstitial !== undefined) body.skip_interstitial = params.skip_interstitial
      if (params.use_clientless_isolation_app_launcher_url !== undefined)
        body.use_clientless_isolation_app_launcher_url =
          params.use_clientless_isolation_app_launcher_url
      if (params.app_launcher_logo_url !== undefined && params.app_launcher_logo_url !== '')
        body.app_launcher_logo_url = params.app_launcher_logo_url
      if (params.bg_color !== undefined && params.bg_color !== '') body.bg_color = params.bg_color
      if (params.footer_links !== undefined && params.footer_links !== '')
        body.footer_links = parseJsonArrayParam(params.footer_links, 'footer_links')
      if (params.header_bg_color !== undefined && params.header_bg_color !== '')
        body.header_bg_color = params.header_bg_color
      if (params.landing_page_design !== undefined && params.landing_page_design !== '')
        body.landing_page_design = parseJsonObjectParam(
          params.landing_page_design,
          'landing_page_design'
        )
      if (params.skip_app_launcher_login_page !== undefined)
        body.skip_app_launcher_login_page = params.skip_app_launcher_login_page
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_APPLICATION_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to create access application') }
        : {}),
    }
  },
  outputs: ACCESS_APPLICATION_OUTPUTS,
}
