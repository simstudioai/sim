import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareDeleteTunnelParams,
  CloudflareDeleteTunnelResponse,
} from '@/tools/cloudflare/operation-types'
import { TUNNEL_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteTunnelTool: ToolConfig<
  CloudflareDeleteTunnelParams,
  CloudflareDeleteTunnelResponse
> = {
  id: 'cloudflare_delete_tunnel',
  name: 'Cloudflare Delete Tunnel',
  description:
    'Permanently deletes a Cloudflare Tunnel from an account. The tunnel must have no active connections.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    tunnelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tunnel id',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}`,
    method: 'DELETE',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to delete tunnel') } : {}),
    }
  },
  outputs: TUNNEL_OUTPUTS,
}
