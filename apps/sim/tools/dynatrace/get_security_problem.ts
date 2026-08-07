import { securityProblemDetailsProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetSecurityProblemParams,
  DynatraceGetSecurityProblemResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapSecurityProblemDetails,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import type { ToolConfig } from '@/tools/types'

export const getSecurityProblemTool: ToolConfig<
  DynatraceGetSecurityProblemParams,
  DynatraceGetSecurityProblemResponse
> = {
  id: 'dynatrace_get_security_problem',
  name: 'Dynatrace Get Security Problem',
  description:
    'Get a single vulnerability with its description, remediation guidance, affected entities, and risk assessment.',
  version: '1.0.0',

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the securityProblems.read scope',
    },
    securityProblemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the security problem',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated optional properties to include: +riskAssessment, +managementZones, +codeLevelVulnerabilityDetails, +globalCounts',
    },
    managementZoneFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the counts to management zones, e.g. names("Production")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-24h. Defaults to the last 24 hours',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/securityProblems/${encodeURIComponent(params.securityProblemId)}`,
        {
          fields: params.fields,
          managementZoneFilter: params.managementZoneFilter,
          from: params.from,
        }
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        securityProblem: mapSecurityProblemDetails(data),
      },
    }
  },

  outputs: {
    securityProblem: {
      type: 'object',
      description: 'The requested security problem',
      properties: securityProblemDetailsProperties,
    },
  },
}
