import type {
  CloudflareListAccessApplicationsParams,
  CloudflareListAccessApplicationsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapAccessApplication,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listAccessApplicationsTool: ToolConfig<
  CloudflareListAccessApplicationsParams,
  CloudflareListAccessApplicationsResponse
> = {
  id: 'cloudflare_list_access_applications',
  name: 'Cloudflare List Access Applications',
  description:
    'Lists the Cloudflare Access (Zero Trust) applications protecting an account. Requires an API token with Account Access: Apps and Policies Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access applications are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by application name',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the primary hostname the application secures',
    },
    aud: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by application audience (AUD) tag',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across applications',
    },
    exact: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the name and domain filters must match exactly',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of applications per page',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps`
      )
      appendParam(url, 'name', params.name)
      appendParam(url, 'domain', params.domain)
      appendParam(url, 'aud', params.aud)
      appendParam(url, 'search', params.search)
      if (params.exact !== undefined) url.searchParams.append('exact', String(params.exact))
      appendParam(url, 'page', params.page)
      appendParam(url, 'per_page', params.per_page)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { applications: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Access applications'),
      }
    }

    const applications = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        applications: applications.map(mapAccessApplication),
        total_count: data.result_info?.total_count ?? applications.length,
      },
    }
  },

  outputs: {
    applications: {
      type: 'array',
      description: 'Access applications in the account',
      items: {
        type: 'object',
        properties: {
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
          aud: {
            type: 'string',
            description: 'Audience tag used to verify Access JWTs',
            optional: true,
          },
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
      },
    },
    total_count: { type: 'number', description: 'Total number of Access applications' },
  },
}
