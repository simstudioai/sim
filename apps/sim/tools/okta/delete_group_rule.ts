import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaDeleteGroupRuleParams, OktaDeleteGroupRuleResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaDeleteGroupRule')

export const oktaDeleteGroupRuleTool: ToolConfig<
  OktaDeleteGroupRuleParams,
  OktaDeleteGroupRuleResponse
> = {
  id: 'okta_delete_group_rule',
  name: 'Delete Group Rule in Okta',
  description:
    'Permanently delete a group rule. Destructive and irreversible. Optionally also removes the users that this rule had assigned from those groups, which revokes any access those groups grant.',
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
      description: 'Group rule ID to delete',
    },
    removeUsers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Also remove the users this rule assigned from the groups it targeted (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const base = `https://${domain}/api/v1/groups/rules/${safeUrlPathSegment(params.groupRuleId, 'groupRuleId')}`
      return params.removeUsers === undefined
        ? base
        : `${base}?removeUsers=${isOktaFlagEnabled(params.removeUsers)}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to delete group rule in Okta')
    }

    return {
      success: true,
      output: {
        groupRuleId: params?.groupRuleId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    groupRuleId: { type: 'string', description: 'Deleted group rule ID' },
    deleted: {
      type: 'boolean',
      description:
        'Whether the deletion was accepted. Okta answers 202 and removes the rule asynchronously.',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
