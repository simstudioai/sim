import { isRecordLike } from '@sim/utils/object'
import { ACCESS_APPLICATION_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareAccessApplicationResponse,
  CloudflareGetAccessApplicationParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps/${safeUrlPathSegment(params.appId, 'appId')}`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_APPLICATION_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to get access application') }
        : {}),
    }
  },
  outputs: ACCESS_APPLICATION_OUTPUTS,
}
