import { remediationItemProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceListRemediationItemsParams,
  DynatraceListRemediationItemsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapRemediationItem,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listRemediationItemsTool: ToolConfig<
  DynatraceListRemediationItemsParams,
  DynatraceListRemediationItemsResponse
> = {
  id: 'dynatrace_list_remediation_items',
  name: 'Dynatrace List Remediation Items',
  description:
    'List the remediation items of a third-party vulnerability — the components to upgrade, their affected entities, and their mute state.',
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
      description: 'ID of the third-party security problem',
    },
    remediationItemSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Remediation item selector, e.g. vulnerabilityState("VULNERABLE"),muted("false"),exposure("PUBLIC_NETWORK")',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/securityProblems/${encodeDynatraceId(params.securityProblemId)}/remediationItems`,
        { remediationItemSelector: params.remediationItemSelector }
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const remediationItems = Array.isArray(data.remediationItems)
      ? (data.remediationItems as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        remediationItems: remediationItems.map(mapRemediationItem),
      },
    }
  },

  outputs: {
    remediationItems: {
      type: 'array',
      description: 'Remediation items of the vulnerability. This endpoint returns no total count',
      items: { type: 'object', properties: remediationItemProperties },
    },
  },
}
