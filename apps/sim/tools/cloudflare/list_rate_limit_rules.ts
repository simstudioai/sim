import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListRateLimitRulesParams,
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

export const listRateLimitRulesTool: ToolConfig<
  CloudflareListRateLimitRulesParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_list_rate_limit_rules',
  name: 'Cloudflare List Rate Limiting Rules',
  description:
    'Lists the rate limiting rules on a zone by reading the http_ratelimit phase entry point ruleset. This uses the current Rulesets-based rate limiting API; the legacy rate_limits endpoint is no longer available. The returned ruleset ID is what "Create Rate Limiting Rule", "Update Rate Limiting Rule", and "Delete Ruleset Rule" need. Requires an API token with Zone WAF Read.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list rate limiting rules for',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/phases/http_ratelimit/entrypoint`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to list rate limit rules') }
        : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
