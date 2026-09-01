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

export const unmuteSecurityProblemTool: ToolConfig<
  DynatraceMuteSecurityProblemParams,
  DynatraceMuteSecurityProblemResponse
> = {
  id: 'dynatrace_unmute_security_problem',
  name: 'Dynatrace Unmute Security Problem',
  description: 'Unmute a single Dynatrace vulnerability, returning it to the active triage queue.',
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
      description: 'ID of the security problem to unmute',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      default: 'AFFECTED',
      description: 'Reason for unmuting. AFFECTED is the only value the API accepts',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Explanation recorded alongside the unmute',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/securityProblems/${encodeDynatraceId(params.securityProblemId)}/unmute`
      ),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const body: Record<string, string> = { reason: params.reason || 'AFFECTED' }
      if (params.comment) body.comment = params.comment
      return body
    },
  },

  /** 200 on success; 204 means it was already unmuted. */
  transformResponse: async (response: Response, params?: DynatraceMuteSecurityProblemParams) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        securityProblemId: params?.securityProblemId ?? '',
        reason: (data.reason as string) ?? params?.reason ?? 'AFFECTED',
        comment: (data.comment as string) ?? params?.comment ?? null,
        alreadyInState: response.status === 204,
      },
    }
  },

  outputs: {
    securityProblemId: { type: 'string', description: 'ID of the unmuted security problem' },
    reason: { type: 'string', description: 'Reason recorded for the unmute', nullable: true },
    comment: { type: 'string', description: 'Comment recorded for the unmute', nullable: true },
    alreadyInState: {
      type: 'boolean',
      description: 'True when Dynatrace reported the problem was already unmuted (HTTP 204)',
    },
  },
}
