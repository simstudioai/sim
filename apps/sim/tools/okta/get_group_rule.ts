import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaGetGroupRuleParams,
  OktaGetGroupRuleResponse,
  OktaGroupRule,
} from '@/tools/okta/types'
import { mapOktaGroupRule, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaGetGroupRule')

export const oktaGetGroupRuleTool: ToolConfig<OktaGetGroupRuleParams, OktaGetGroupRuleResponse> = {
  id: 'okta_get_group_rule',
  name: 'Get Group Rule from Okta',
  description:
    'Retrieve a single Okta group rule by ID, including the expression that decides which users it matches and the groups those users are assigned to.',
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
      description: 'Group rule ID to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/rules/${encodeURIComponent(params.groupRuleId.trim())}`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get group rule from Okta')
    }

    const rule: OktaGroupRule = await response.json()

    return {
      success: true,
      output: {
        ...mapOktaGroupRule(rule),
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Group rule ID' },
    name: { type: 'string', description: 'Group rule name' },
    type: { type: 'string', description: 'Rule type, always group_rule' },
    status: { type: 'string', description: 'Rule status (ACTIVE, INACTIVE, INVALID)' },
    created: { type: 'string', description: 'Creation timestamp', optional: true },
    lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
    expression: {
      type: 'string',
      description: 'Okta expression that decides which users the rule matches',
      optional: true,
    },
    expressionType: {
      type: 'string',
      description: 'Expression language, typically urn:okta:expression:1.0',
      optional: true,
    },
    assignUserToGroupIds: {
      type: 'array',
      description: 'Groups that matching users are assigned to',
      items: { type: 'string', description: 'Group ID' },
    },
    excludedUserIds: {
      type: 'array',
      description: 'Users excluded from the rule',
      items: { type: 'string', description: 'User ID' },
    },
    excludedGroupIds: {
      type: 'array',
      description:
        'Groups excluded from the rule. Always empty — Okta does not currently support group exclusions.',
      items: { type: 'string', description: 'Group ID' },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
