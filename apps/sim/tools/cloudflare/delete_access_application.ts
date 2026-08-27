import type {
  CloudflareDeleteAccessApplicationParams,
  CloudflareDeletedIdResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteAccessApplicationTool: ToolConfig<
  CloudflareDeleteAccessApplicationParams,
  CloudflareDeletedIdResponse
> = {
  id: 'cloudflare_delete_access_application',
  name: 'Cloudflare Delete Access Application',
  description:
    'Permanently deletes a Cloudflare Access (Zero Trust) application and every policy attached to it. The hostname it protected is immediately left without an Access identity check, so anyone who can reach it can reach the origin. This cannot be undone. Requires an API token with Account Access: Apps and Policies Edit.',
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
      description: 'The Access application ID to delete permanently',
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
    method: 'DELETE',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { id: '' },
        error: cloudflareErrorMessage(data, 'Failed to delete Access application'),
      }
    }

    return { success: true, output: { id: data.result?.id ?? '' } }
  },

  outputs: {
    id: { type: 'string', description: 'Identifier of the deleted Access application' },
  },
}
