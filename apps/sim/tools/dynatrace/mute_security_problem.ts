import type {
  DynatraceMuteSecurityProblemParams,
  DynatraceMuteSecurityProblemResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const muteSecurityProblemTool: ToolConfig<
  DynatraceMuteSecurityProblemParams,
  DynatraceMuteSecurityProblemResponse
> = {
  id: 'dynatrace_mute_security_problem',
  name: 'Dynatrace Mute Security Problem',
  description:
    'Mute a single Dynatrace vulnerability with a reason, for triaging false positives or accepted risk.',
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
      description: 'Dynatrace access token (dt0c01...) with the securityProblems.write scope',
    },
    securityProblemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the security problem to mute',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'One of CONFIGURATION_NOT_AFFECTED, FALSE_POSITIVE, IGNORE, OTHER, VULNERABLE_CODE_NOT_IN_USE',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Explanation recorded alongside the mute',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/securityProblems/${encodeDynatraceId(params.securityProblemId)}/mute`
      ),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const body: Record<string, string> = { reason: params.reason }
      if (params.comment) body.comment = params.comment
      return body
    },
  },

  /** 200 carries the applied reason/comment; 204 means it was already muted. */
  transformResponse: async (response: Response, params?: DynatraceMuteSecurityProblemParams) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        securityProblemId: params?.securityProblemId ?? '',
        reason: (data.reason as string) ?? params?.reason ?? null,
        comment: (data.comment as string) ?? params?.comment ?? null,
        alreadyInState: response.status === 204,
      },
    }
  },

  outputs: {
    securityProblemId: { type: 'string', description: 'ID of the muted security problem' },
    reason: { type: 'string', description: 'Reason recorded for the mute', nullable: true },
    comment: { type: 'string', description: 'Comment recorded for the mute', nullable: true },
    alreadyInState: {
      type: 'boolean',
      description: 'True when Dynatrace reported the problem was already muted (HTTP 204)',
    },
  },
}
