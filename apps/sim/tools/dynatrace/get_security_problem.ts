import { securityProblemDetailsProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetSecurityProblemParams,
  DynatraceGetSecurityProblemResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapSecurityProblemDetails,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/**
 * Every optional property of the vulnerability detail endpoint. Dynatrace omits
 * all of them unless they are requested, so without this default the tool would
 * answer with nulls for the description, remediation guidance, and affected
 * entities it exists to return.
 */
const SECURITY_PROBLEM_DETAIL_FIELDS = [
  '+riskAssessment',
  '+managementZones',
  '+codeLevelVulnerabilityDetails',
  '+globalCounts',
  '+filteredCounts',
  '+description',
  '+remediationDescription',
  '+events',
  '+vulnerableComponents',
  '+affectedEntities',
  '+exposedEntities',
  '+reachableDataAssets',
  '+relatedEntities',
  '+relatedContainerImages',
  '+relatedAttacks',
  '+entryPoints',
].join(',')

export const getSecurityProblemTool: ToolConfig<
  DynatraceGetSecurityProblemParams,
  DynatraceGetSecurityProblemResponse
> = {
  id: 'dynatrace_get_security_problem',
  name: 'Dynatrace Get Security Problem',
  description:
    'Get a single vulnerability with its description, remediation guidance, affected entities, and risk assessment.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

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
        'Comma-separated optional properties to include, each prefixed with +. Defaults to every detail property: +riskAssessment, +managementZones, +codeLevelVulnerabilityDetails, +globalCounts, +filteredCounts, +description, +remediationDescription, +events, +vulnerableComponents, +affectedEntities, +exposedEntities, +reachableDataAssets, +relatedEntities, +relatedContainerImages, +relatedAttacks, +entryPoints',
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
        `/securityProblems/${encodeDynatraceId(params.securityProblemId)}`,
        {
          fields: params.fields || SECURITY_PROBLEM_DETAIL_FIELDS,
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
