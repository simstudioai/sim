import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareGetRulesetParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getRulesetTool: ToolConfig<CloudflareGetRulesetParams, CloudflareRulesetResponse> = {
  id: 'cloudflare_get_ruleset',
  name: 'Cloudflare Get Ruleset',
  description:
    'Reads a single zone ruleset including every rule it contains, in evaluation order. Requires an API token with Zone WAF Read (or another matching ruleset Read permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID that owns the ruleset',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ruleset ID to read',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/${safeUrlPathSegment(params.rulesetId, 'rulesetId')}`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get ruleset') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
