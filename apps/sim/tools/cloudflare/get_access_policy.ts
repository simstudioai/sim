import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareGetAccessPolicyParams,
  CloudflareGetAccessPolicyResponse,
} from '@/tools/cloudflare/operation-types'
import { ACCESS_POLICY_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getAccessPolicyTool: ToolConfig<
  CloudflareGetAccessPolicyParams,
  CloudflareGetAccessPolicyResponse
> = {
  id: 'cloudflare_get_access_policy',
  name: 'Cloudflare Get Access Policy',
  description:
    'Fetches a single Access policy configured for an application. Returns both exclusively owned and reusable policies used by the application.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'App id',
    },
    policyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Policy id',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps/${safeUrlPathSegment(params.appId, 'appId')}/policies/${safeUrlPathSegment(params.policyId, 'policyId')}`,
    method: 'GET',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_POLICY_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get access policy') } : {}),
    }
  },
  outputs: ACCESS_POLICY_OUTPUTS,
}
