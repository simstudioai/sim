import type {
  ListSecurityRulesParams,
  ListSecurityRulesResponse,
  SecurityRuleData,
} from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listSecurityRulesTool: ToolConfig<ListSecurityRulesParams, ListSecurityRulesResponse> =
  {
    id: 'datadog_list_security_rules',
    name: 'Datadog List Security Rules',
    description:
      'List Cloud SIEM detection rules. Requires the `security_monitoring_rules_read` permission.',
    version: '1.0.0',

    params: {
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Search query filtering rules by attributes such as type, source, or tags (e.g., "type:log_detection source:cloudtrail")',
      },
      sort: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Sort attribute, prefix with "-" for descending: name, creation_date, update_date, enabled, type, highest_severity, or source',
      },
      pageSize: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of rules per page (default: 10, max: 100)',
      },
      pageNumber: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page to retrieve, starting at zero',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Datadog API key',
      },
      applicationKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Datadog Application key',
      },
      site: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Datadog site/region (default: datadoghq.com)',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.query) queryParams.set('query', params.query)
        if (params.sort) queryParams.set('sort', params.sort)
        if (params.pageSize !== undefined) queryParams.set('page[size]', String(params.pageSize))
        if (params.pageNumber !== undefined)
          queryParams.set('page[number]', String(params.pageNumber))
        const queryString = queryParams.toString()
        return datadogApiUrl(
          params.site,
          `/api/v2/security_monitoring/rules${queryString ? `?${queryString}` : ''}`
        )
      },
      method: 'GET',
      headers: datadogHeaders,
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        return {
          success: false,
          output: { rules: [] },
          error: await datadogErrorMessage(response),
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          rules: (data.data ?? []).map((rule: SecurityRuleData) => ({
            id: rule.id,
            name: rule.name,
            type: rule.type,
            message: rule.message,
            tags: rule.tags ?? [],
            isEnabled: rule.isEnabled,
            isDefault: rule.isDefault,
            createdAt: rule.createdAt,
            version: rule.version,
          })),
        },
      }
    },

    outputs: {
      rules: {
        type: 'array',
        description: 'List of detection rules',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Rule ID' },
            name: { type: 'string', description: 'Rule name' },
            type: { type: 'string', description: 'Rule type' },
            message: { type: 'string', description: 'Message attached to generated signals' },
            tags: { type: 'array', description: 'Rule tags' },
            isEnabled: { type: 'boolean', description: 'Whether the rule is enabled' },
            isDefault: {
              type: 'boolean',
              description: 'Whether the rule is a Datadog default rule',
            },
            createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
            version: { type: 'number', description: 'Rule version' },
          },
        },
      },
    },
  }
