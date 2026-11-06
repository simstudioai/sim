import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareGetAccessGroupParams,
  CloudflareGetAccessGroupResponse,
} from '@/tools/cloudflare/operation-types'
import { ACCESS_GROUP_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getAccessGroupTool: ToolConfig<
  CloudflareGetAccessGroupParams,
  CloudflareGetAccessGroupResponse
> = {
  id: 'cloudflare_get_access_group',
  name: 'Cloudflare Get Access Group',
  description: 'Fetches a single Access group.',
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
    method: 'GET',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_GROUP_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get access group') } : {}),
    }
  },
  outputs: ACCESS_GROUP_OUTPUTS,
}
