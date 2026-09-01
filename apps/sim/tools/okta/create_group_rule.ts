import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaCreateGroupRuleParams,
  OktaCreateGroupRuleResponse,
  OktaGroupRule,
} from '@/tools/okta/types'
import { mapOktaGroupRule, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaCreateGroupRule')

/**
 * Splits a comma or newline separated ID list into trimmed, non-empty entries.
 */
function parseIdList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

export const oktaCreateGroupRuleTool: ToolConfig<
  OktaCreateGroupRuleParams,
  OktaCreateGroupRuleResponse
> = {
  id: 'okta_create_group_rule',
  name: 'Create Group Rule in Okta',
  description:
    'Create a group rule that automatically assigns users matching an Okta expression to one or more groups. New rules are created INACTIVE, so run Activate Group Rule afterwards to start applying it.',
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
    ruleName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the group rule (maximum 50 characters)',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Okta expression that must evaluate to a boolean (e.g., user.department=="Engineering")',
    },
    assignUserToGroupIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated group IDs that matching users are assigned to',
    },
    excludedUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to exclude from the rule',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/rules`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => {
      const conditions: Record<string, unknown> = {
        expression: {
          type: 'urn:okta:expression:1.0',
          value: params.expression,
        },
      }

      const excludedUserIds = parseIdList(params.excludedUserIds)
      if (excludedUserIds.length > 0) {
        conditions.people = { users: { exclude: excludedUserIds } }
      }

      return {
        type: 'group_rule',
        name: params.ruleName,
        conditions,
        actions: {
          assignUserToGroups: { groupIds: parseIdList(params.assignUserToGroupIds) },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to create group rule in Okta')
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
    id: { type: 'string', description: 'Created group rule ID' },
    name: { type: 'string', description: 'Group rule name' },
    type: { type: 'string', description: 'Rule type, always group_rule' },
    status: {
      type: 'string',
      description: 'Rule status, which is INACTIVE for a newly created rule',
    },
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
