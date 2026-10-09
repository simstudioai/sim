import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type { CheckrGetProgressiveStatusResponse, CheckrReportIdParams } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetReportProgressiveStatusTool: ToolConfig<
  CheckrReportIdParams,
  CheckrGetProgressiveStatusResponse
> = {
  id: 'checkr_get_report_progressive_status',
  name: 'Checkr Get Progressive Report Status',
  description:
    'Retrieve checkpoint progress for an Enterprise Progressive report, including which checkpoint is waiting on a review action.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the progressive report',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/progressive/status`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const report = toRecord(data.report)
    return {
      success: true,
      output: {
        report: {
          id: typeof report.id === 'string' ? report.id : null,
          uri: typeof report.uri === 'string' ? report.uri : null,
          status: typeof report.status === 'string' ? report.status : null,
        },
        progressiveContinuationStatus: data.progressive_continuation_status ?? null,
        expiresAt: data.expires_at ?? null,
        checkpoints: toArray(data.checkpoints).map((value) => {
          const checkpoint = toRecord(value)
          const review = toRecordOrNull(checkpoint.user_review)
          return {
            position: typeof checkpoint.position === 'number' ? checkpoint.position : null,
            name: typeof checkpoint.name === 'string' ? checkpoint.name : null,
            status: typeof checkpoint.status === 'string' ? checkpoint.status : null,
            productKeys: toArray(checkpoint.products)
              .map((product) => toRecord(product).product_key)
              .filter((key): key is string => typeof key === 'string'),
            userReview: review
              ? {
                  status: typeof review.status === 'string' ? review.status : null,
                  decision: typeof review.decision === 'string' ? review.decision : null,
                  expired: typeof review.expired === 'boolean' ? review.expired : null,
                  pausedAt: typeof review.paused_at === 'string' ? review.paused_at : null,
                }
              : null,
          }
        }),
      },
    }
  },

  outputs: {
    report: {
      type: 'object',
      description: 'Report identity and status',
      properties: {
        id: { type: 'string', description: 'Report ID', nullable: true },
        uri: { type: 'string', description: 'Report API URI', nullable: true },
        status: { type: 'string', description: 'Report status', nullable: true },
      },
    },
    progressiveContinuationStatus: {
      type: 'string',
      description: 'Whether the report can still be advanced (eligible, ineligible, expired)',
      nullable: true,
    },
    expiresAt: {
      type: 'string',
      description: 'Deadline for applying a review action to run the remaining screenings',
      nullable: true,
    },
    checkpoints: {
      type: 'array',
      description: 'Ordered progressive checkpoints',
      items: {
        type: 'object',
        properties: {
          position: { type: 'number', description: '1-based checkpoint position', nullable: true },
          name: { type: 'string', description: 'Checkpoint name', nullable: true },
          status: {
            type: 'string',
            description:
              'Checkpoint status (defined, prepared, start_requested, in_progress, completed, skipped, canceled, failed)',
            nullable: true,
          },
          productKeys: {
            type: 'array',
            description: 'Product keys run at this checkpoint, e.g. ssn_trace',
            items: { type: 'string' },
          },
          userReview: {
            type: 'object',
            description: 'User review state for the checkpoint',
            nullable: true,
            properties: {
              status: { type: 'string', description: 'Review status', nullable: true },
              decision: {
                type: 'string',
                description: 'Decision applied (continue, skip, or a custom label)',
                nullable: true,
              },
              expired: {
                type: 'boolean',
                description: 'Whether the review window closed and the default decision applied',
                nullable: true,
              },
              pausedAt: {
                type: 'string',
                description: 'Time the report paused for this review',
                nullable: true,
              },
            },
          },
        },
      },
    },
  },
}
