import type {
  CloudflareListManagedRulesetOverridesParams,
  CloudflareListManagedRulesetOverridesResponse,
  CloudflareRawRuleset,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listManagedRulesetOverridesTool: ToolConfig<
  CloudflareListManagedRulesetOverridesParams,
  CloudflareListManagedRulesetOverridesResponse
> = {
  id: 'cloudflare_list_managed_ruleset_overrides',
  name: 'Cloudflare List Managed Ruleset Overrides',
  description:
    'Lists the WAF managed rulesets deployed on a zone together with the overrides applied to each one. Cloudflare has no dedicated overrides endpoint — overrides live on the "execute" rules of the http_request_firewall_managed phase entry point ruleset, which this reads. Requires an API token with Zone WAF Read.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to read managed ruleset deployments and overrides for',
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
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId.trim()}/rulesets/phases/http_request_firewall_managed/entrypoint`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawRuleset>(response)

    if (!data.success) {
      return {
        success: false,
        output: { ruleset_id: '', deployments: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list managed ruleset overrides'),
      }
    }

    const rules = Array.isArray(data.result?.rules) ? data.result.rules : []
    const deployments = rules
      .filter((rule) => rule.action === 'execute')
      .map((rule) => ({
        rule_id: rule.id ?? '',
        managed_ruleset_id: rule.action_parameters?.id ?? null,
        description: rule.description ?? '',
        expression: rule.expression ?? '',
        enabled: rule.enabled ?? false,
        overrides: rule.action_parameters?.overrides ?? null,
      }))

    return {
      success: true,
      output: {
        ruleset_id: data.result?.id ?? '',
        deployments,
        total_count: deployments.length,
      },
    }
  },

  outputs: {
    ruleset_id: {
      type: 'string',
      description:
        'Ruleset ID of the http_request_firewall_managed entry point, needed to edit a deployment rule',
    },
    deployments: {
      type: 'array',
      description: 'Managed rulesets deployed on the zone and the overrides applied to each',
      items: {
        type: 'object',
        properties: {
          rule_id: {
            type: 'string',
            description: 'ID of the execute rule that deploys the managed ruleset',
          },
          managed_ruleset_id: {
            type: 'string',
            description: 'ID of the deployed managed ruleset',
            optional: true,
          },
          description: { type: 'string', description: 'Description of the deployment rule' },
          expression: {
            type: 'string',
            description: 'Filter expression scoping which requests the managed ruleset runs on',
          },
          enabled: { type: 'boolean', description: 'Whether the deployment is enabled' },
          overrides: {
            type: 'json',
            description:
              'Overrides applied to the managed ruleset, at three levels — ruleset (top level), categories, and rules. The Rulesets engine documents action and enabled as the properties overridable at every level; individual managed rulesets may add more, and the OWASP Core Ruleset also accepts score_threshold on a rule override',
            optional: true,
          },
        },
      },
    },
    total_count: { type: 'number', description: 'Number of managed ruleset deployments found' },
  },
}
