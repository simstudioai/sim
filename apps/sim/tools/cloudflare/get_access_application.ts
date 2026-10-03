import type {
  CloudflareAccessApplicationResponse,
  CloudflareGetAccessApplicationParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyAccessApplication,
  mapAccessApplication,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const getAccessApplicationTool: ToolConfig<
  CloudflareGetAccessApplicationParams,
  CloudflareAccessApplicationResponse
> = {
  id: 'cloudflare_get_access_application',
  name: 'Cloudflare Get Access Application',
  description:
    'Reads a single Cloudflare Access (Zero Trust) application, including its attached policies. Requires an API token with Account Access: Apps and Policies Read.',
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
      description: 'The Access application ID (or audience tag) to read',
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
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyAccessApplication(),
        error: cloudflareErrorMessage(data, 'Failed to get Access application'),
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
    type: {
      type: 'string',
      description: 'Application type (e.g., self_hosted, saas, ssh, app_launcher, bookmark)',
      optional: true,
    },
    aud: { type: 'string', description: 'Audience tag used to verify Access JWTs', optional: true },
    session_duration: {
      type: 'string',
      description: 'How long an Access session stays valid (e.g., 24h)',
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
