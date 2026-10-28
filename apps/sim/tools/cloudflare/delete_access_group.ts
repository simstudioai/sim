import type {
  CloudflareDeleteAccessGroupParams,
  CloudflareDeleteAccessGroupResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteAccessGroupTool: ToolConfig<
  CloudflareDeleteAccessGroupParams,
  CloudflareDeleteAccessGroupResponse
> = {
  id: 'cloudflare_delete_access_group',
  name: 'Cloudflare Delete Access Group',
  description: 'Deletes an Access group.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/groups/${safeUrlPathSegment(params.groupId, 'groupId')}`,
    method: 'DELETE',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: mapCloudflareFields(data.result, {
        id: { type: 'string', nullable: true, description: 'UUID.' },
      } as const),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to delete access group') } : {}),
    }
  },
  outputs: { id: { type: 'string', nullable: true, description: 'UUID.' } },
}
