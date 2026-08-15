import type {
  CloudflareDeleteAccessPolicyParams,
  CloudflareDeletedIdResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteAccessPolicyTool: ToolConfig<
  CloudflareDeleteAccessPolicyParams,
  CloudflareDeletedIdResponse
> = {
  id: 'cloudflare_delete_access_policy',
  name: 'Cloudflare Delete Access Policy',
  description:
    'Permanently deletes a Cloudflare Access (Zero Trust) policy from an application. This changes who can reach the application the moment it runs: removing an allow policy locks out everyone it covered, and removing a deny or require policy drops that restriction. This cannot be undone. Requires an API token with Account Access: Apps and Policies Edit.',
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
      description: 'The Access application ID that owns the policy',
    },
    policyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Access policy ID to delete permanently',
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
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/apps/${params.appId.trim()}/policies/${params.policyId.trim()}`,
    method: 'DELETE',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { id: '' },
        error: cloudflareErrorMessage(data, 'Failed to delete Access policy'),
      }
    }

    return { success: true, output: { id: data.result?.id ?? '' } }
  },

  outputs: {
    id: { type: 'string', description: 'Identifier of the deleted Access policy' },
  },
}
