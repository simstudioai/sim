import type {
  CheckrApplyReviewActionParams,
  CheckrApplyReviewActionResponse,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

const REVIEW_DECISIONS = ['continue', 'skip_remaining'] as const

export const checkrApplyReportReviewActionTool: ToolConfig<
  CheckrApplyReviewActionParams,
  CheckrApplyReviewActionResponse
> = {
  id: 'checkr_apply_report_review_action',
  name: 'Checkr Apply Report Review Action',
  description:
    'Continue or skip the remaining screenings on a report that is paused awaiting a review action.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the paused report',
    },
    decision: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'continue to run the remaining screenings, or skip_remaining to skip them and complete the report',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/review_action`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const decision = params.decision?.trim()
      if (!REVIEW_DECISIONS.includes(decision as (typeof REVIEW_DECISIONS)[number])) {
        throw new Error('Invalid decision: expected continue or skip_remaining.')
      }
      return { decision }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { message: data.message ?? null } }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message from Checkr', nullable: true },
  },
}
