import type {
  CloudflareListAccessGroupsParams,
  CloudflareListAccessGroupsResponse,
  CloudflareRawAccessGroup,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listAccessGroupsTool: ToolConfig<
  CloudflareListAccessGroupsParams,
  CloudflareListAccessGroupsResponse
> = {
  id: 'cloudflare_list_access_groups',
  name: 'Cloudflare List Access Groups',
  description:
    'Lists the reusable Cloudflare Access (Zero Trust) groups in an account. Groups bundle identity rules that policies can reference by ID. Requires an API token with Account Access: Organizations, Identity Providers, and Groups Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access groups are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by group name',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across groups',
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
      description: 'Number of groups per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/groups`
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
    const data = await readCloudflareResponse<CloudflareRawAccessGroup[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { groups: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Access groups'),
      }
    }

    const groups = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        groups: groups.map((group) => ({
          id: group.id ?? '',
          name: group.name ?? null,
          is_default: group.is_default ?? null,
          include: group.include ?? null,
          exclude: group.exclude ?? null,
          require: group.require ?? null,
          created_at: group.created_at ?? null,
          updated_at: group.updated_at ?? null,
        })),
        total_count: data.result_info?.total_count ?? groups.length,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'Access groups in the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Access group identifier' },
          name: { type: 'string', description: 'Group name', optional: true },
          is_default: {
            type: 'json',
            description:
              'Rules that place this group in every Access application by default. Cloudflare returns an array of rule objects here, not a boolean',
            optional: true,
          },
          include: {
            type: 'json',
            description: 'Rules evaluated with OR logic',
            optional: true,
          },
          exclude: { type: 'json', description: 'Rules evaluated with NOT logic', optional: true },
          require: { type: 'json', description: 'Rules evaluated with AND logic', optional: true },
          created_at: { type: 'string', description: 'Creation timestamp', optional: true },
          updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
    total_count: { type: 'number', description: 'Total number of Access groups' },
  },
}
