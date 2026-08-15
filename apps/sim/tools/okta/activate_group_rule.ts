import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaActivateGroupRuleParams, OktaActivateGroupRuleResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaActivateGroupRule')

export const oktaActivateGroupRuleTool: ToolConfig<
  OktaActivateGroupRuleParams,
  OktaActivateGroupRuleResponse
> = {
  id: 'okta_activate_group_rule',
  name: 'Activate Group Rule in Okta',
  description:
    'Activate a group rule so Okta starts applying it, assigning every matching user to the target groups.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    groupRuleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group rule ID to activate',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/rules/${encodeURIComponent(params.groupRuleId.trim())}/lifecycle/activate`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to activate group rule in Okta')
    }

    return {
      success: true,
      output: {
        groupRuleId: params?.groupRuleId ?? '',
        activated: true,
        success: true,
      },
    }
  },

  outputs: {
    groupRuleId: { type: 'string', description: 'Activated group rule ID' },
    activated: { type: 'boolean', description: 'Whether the rule was activated' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
