import { muteSummaryOutput } from '@/tools/dynatrace/outputs'
import type {
  DynatraceMuteSecurityProblemsParams,
  DynatraceMuteSecurityProblemsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapMuteSummary,
  readJsonBody,
  toStringList,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const unmuteSecurityProblemsTool: ToolConfig<
  DynatraceMuteSecurityProblemsParams,
  DynatraceMuteSecurityProblemsResponse
> = {
  id: 'dynatrace_unmute_security_problems',
  name: 'Dynatrace Unmute Security Problems',
  description: 'Unmute several Dynatrace vulnerabilities at once, returning them to active triage.',
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
    securityProblemIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Security problem IDs to unmute, comma-separated or as a JSON array',
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
      description: 'Explanation recorded against every unmuted problem',
    },
  },

  request: {
    url: (params) => buildDynatraceUrl(params.environmentUrl, '/securityProblems/unmute'),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const securityProblemIds = toStringList(params.securityProblemIds)
      if (securityProblemIds.length === 0) {
        throw new Error('securityProblemIds must contain at least one ID')
      }
      const body: Record<string, unknown> = {
        securityProblemIds,
        reason: params.reason || 'AFFECTED',
      }
      if (params.comment) body.comment = params.comment
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const summary = mapMuteSummary(data.summary)

    return {
      success: true,
      output: {
        summary,
        changedCount: summary.filter((entry) => entry.muteStateChangeTriggered).length,
      },
    }
  },

  outputs: {
    summary: muteSummaryOutput,
    changedCount: {
      type: 'number',
      description: 'How many problems actually changed state, excluding those already unmuted',
    },
  },
}
