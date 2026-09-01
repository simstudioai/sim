import type {
  CloudflareListAccessServiceTokensParams,
  CloudflareListAccessServiceTokensResponse,
  CloudflareRawAccessServiceToken,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listAccessServiceTokensTool: ToolConfig<
  CloudflareListAccessServiceTokensParams,
  CloudflareListAccessServiceTokensResponse
> = {
  id: 'cloudflare_list_access_service_tokens',
  name: 'Cloudflare List Access Service Tokens',
  description:
    'Lists the Cloudflare Access (Zero Trust) service tokens in an account, which let machines authenticate to Access-protected applications. Client secrets are never returned by this endpoint — only on creation. Requires an API token with Account Access: Service Tokens Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Service tokens are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by service token name',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across service tokens',
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
      description: 'Number of service tokens per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/service_tokens`
      )
      appendParam(url, 'name', params.name)
      appendParam(url, 'search', params.search)
      appendParam(url, 'page', params.page)
      appendParam(url, 'per_page', params.per_page)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawAccessServiceToken[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { service_tokens: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Access service tokens'),
      }
    }

    const tokens = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        service_tokens: tokens.map((token) => ({
          id: token.id ?? '',
          name: token.name ?? null,
          client_id: token.client_id ?? null,
          duration: token.duration ?? null,
          enabled: token.enabled ?? null,
          expires_at: token.expires_at ?? null,
          last_seen_at: token.last_seen_at ?? null,
          created_at: token.created_at ?? null,
          updated_at: token.updated_at ?? null,
        })),
        total_count: data.result_info?.total_count ?? tokens.length,
      },
    }
  },

  outputs: {
    service_tokens: {
      type: 'array',
      description: 'Access service tokens in the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Service token identifier' },
          name: { type: 'string', description: 'Service token name', optional: true },
          client_id: {
            type: 'string',
            description: 'Client ID sent in the CF-Access-Client-Id header',
            optional: true,
          },
          duration: {
            type: 'string',
            description: 'How long the token stays valid before it expires',
            optional: true,
          },
          enabled: { type: 'boolean', description: 'Whether the token is active', optional: true },
          expires_at: { type: 'string', description: 'Expiry timestamp', optional: true },
          last_seen_at: {
            type: 'string',
            description: 'When the token was last used',
            optional: true,
          },
          created_at: { type: 'string', description: 'Creation timestamp', optional: true },
          updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
    total_count: { type: 'number', description: 'Total number of service tokens' },
  },
}
