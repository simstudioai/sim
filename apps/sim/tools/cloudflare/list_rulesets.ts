import { LIST_RULESETS_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListRulesetsParams,
  CloudflareListRulesetsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listRulesetsTool: ToolConfig<
  CloudflareListRulesetsParams,
  CloudflareListRulesetsResponse
> = {
  id: 'cloudflare_list_rulesets',
  name: 'Cloudflare List Rulesets',
  description:
    'Lists every ruleset defined on a zone across all phases (WAF custom rules, managed rules, rate limiting, transform rules, and more). The list response deliberately omits the rules inside each ruleset — use "Get Ruleset" to read them. Requires an API token with Zone WAF Read (or another matching ruleset Read permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list rulesets for',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rulesets to return per page',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor for the next page, taken from the cursor output of a previous call. This endpoint paginates by cursor, not by page number',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets`
      )
      appendParam(url, 'per_page', params.per_page)
      appendParam(url, 'cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        rulesets: rows.map((row) => mapCloudflareFields(row, LIST_RULESETS_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
        cursor: data.result_info?.cursors?.after ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list rulesets') } : {}),
    }
  },
  outputs: {
    rulesets: {
      type: 'array',
      description: 'Rulesets',
      items: { type: 'object', properties: LIST_RULESETS_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
    cursor: { type: 'string', description: 'Cursor for the next page', nullable: true },
  },
}
