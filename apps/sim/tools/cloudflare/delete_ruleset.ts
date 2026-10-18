import type {
  CloudflareDeleteRulesetParams,
  CloudflareDeleteRulesetResponse,
} from '@/tools/cloudflare/operation-types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteRulesetTool: ToolConfig<
  CloudflareDeleteRulesetParams,
  CloudflareDeleteRulesetResponse
> = {
  id: 'cloudflare_delete_ruleset',
  name: 'Cloudflare Delete Ruleset',
  description: 'Deletes all versions of an existing zone ruleset.',
  version: '1.0.0',
  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zone id',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ruleset id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    dry_run: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Validates the request without persisting changes when set to `true`. Responses that normally return 200 return `result: null`; endpoints that normally return 204 continue to return 204.',
    },
  },
  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/${safeUrlPathSegment(params.rulesetId, 'rulesetId')}`
      )
      appendParam(url, 'dry_run', params.dry_run)
      return url.toString()
    },
    method: 'DELETE',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    if (response.status === 204) return { success: true, output: { success: true } }
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: { success },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to delete ruleset') } : {}),
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Cloudflare accepted the operation' },
  },
}
