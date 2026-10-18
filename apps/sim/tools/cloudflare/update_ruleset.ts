import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateRulesetParams,
  CloudflareUpdateRulesetResponse,
} from '@/tools/cloudflare/operation-types'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  parseJsonArrayParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateRulesetTool: ToolConfig<
  CloudflareUpdateRulesetParams,
  CloudflareUpdateRulesetResponse
> = {
  id: 'cloudflare_update_ruleset',
  name: 'Cloudflare Update Ruleset',
  description:
    'Updates the description and rules of a zone ruleset, creating a new version. Read the current rules with "Get Ruleset" before replacing the list. The rules array replaces the complete list: include every existing rule you want to keep; omitted rules are removed. Use "Create Ruleset Rule" to add a single rule without replacing the list.',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An informative description of the ruleset.',
    },
    rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array replacing the complete rule list. Read "Get Ruleset" first and include every rule to retain; omitted rules are removed, and [] removes all rules. Fields: action, action_parameters, categories, description, enabled, exposed_credential_check, expression, id, last_updated, logging, ratelimit, ref, version.',
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
    method: 'PUT',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      description: params.description,
      rules: parseJsonArrayParam(params.rules, 'rules'),
    }),
  },
  transformResponse: async (response, params) => {
    const data = await readCloudflareResponse(response)
    const success =
      response.ok &&
      data.success === true &&
      (isRecordLike(data.result) || (params?.dry_run === true && data.result === null))
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update ruleset') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
