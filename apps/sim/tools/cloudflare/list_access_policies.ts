import type {
  CloudflareListAccessPoliciesParams,
  CloudflareListAccessPoliciesResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapAccessPolicy,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listAccessPoliciesTool: ToolConfig<
  CloudflareListAccessPoliciesParams,
  CloudflareListAccessPoliciesResponse
> = {
  id: 'cloudflare_list_access_policies',
  name: 'Cloudflare List Access Policies',
  description:
    'Lists the Cloudflare Access (Zero Trust) policies attached to an application, in precedence order. Requires an API token with Account Access: Apps and Policies Read.',
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
      description: 'The Access application ID whose policies should be listed',
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
      description: 'Number of policies per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/apps/${params.appId.trim()}/policies`
      )
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
        output: { policies: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Access policies'),
      }
    }

    const policies = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        policies: policies.map(mapAccessPolicy),
        total_count: data.result_info?.total_count ?? policies.length,
      },
    }
  },

  outputs: {
    policies: {
      type: 'array',
      description: 'Access policies attached to the application',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Policy identifier' },
          name: { type: 'string', description: 'Policy name', optional: true },
          decision: {
            type: 'string',
            description: 'Decision the policy applies: allow, deny, non_identity, or bypass',
            optional: true,
          },
          precedence: {
            type: 'number',
            description: 'Evaluation order of the policy within the application',
            optional: true,
          },
          include: {
            type: 'json',
            description: 'Rules evaluated with OR logic — matching any one selects the policy',
            optional: true,
          },
          exclude: {
            type: 'json',
            description: 'Rules evaluated with NOT logic — matching any one rejects the request',
            optional: true,
          },
          require: {
            type: 'json',
            description: 'Rules evaluated with AND logic — all must match',
            optional: true,
          },
          session_duration: {
            type: 'string',
            description: 'How long a session granted by this policy stays valid',
            optional: true,
          },
          approval_required: {
            type: 'boolean',
            description: 'Whether an approver must grant each access request',
            optional: true,
          },
          isolation_required: {
            type: 'boolean',
            description: 'Whether the session must run in a remote browser',
            optional: true,
          },
          purpose_justification_required: {
            type: 'boolean',
            description: 'Whether users must state a reason for access',
            optional: true,
          },
          purpose_justification_prompt: {
            type: 'string',
            description: 'Prompt shown when a justification is required',
            optional: true,
          },
          created_at: { type: 'string', description: 'Creation timestamp', optional: true },
          updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
    total_count: { type: 'number', description: 'Total number of policies' },
  },
}
