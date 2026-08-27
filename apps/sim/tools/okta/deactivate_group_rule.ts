import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaDeactivateGroupRuleParams,
  OktaDeactivateGroupRuleResponse,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaDeactivateGroupRule')

export const oktaDeactivateGroupRuleTool: ToolConfig<
  OktaDeactivateGroupRuleParams,
  OktaDeactivateGroupRuleResponse
> = {
  id: 'okta_deactivate_group_rule',
  name: 'Deactivate Group Rule in Okta',
  description:
    'Deactivate a group rule so Okta stops applying it. Existing memberships the rule created are left in place. A rule must be INACTIVE before it can be edited.',
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
      description: 'Group rule ID to deactivate',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/rules/${encodeURIComponent(params.groupRuleId.trim())}/lifecycle/deactivate`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to deactivate group rule in Okta')
    }

    return {
      success: true,
      output: {
        groupRuleId: params?.groupRuleId ?? '',
        deactivated: true,
        success: true,
      },
    }
  },

  outputs: {
    groupRuleId: { type: 'string', description: 'Deactivated group rule ID' },
    deactivated: { type: 'boolean', description: 'Whether the rule was deactivated' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
