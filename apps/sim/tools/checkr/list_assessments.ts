import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type { CheckrListAssessmentsResponse, CheckrReportIdParams } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListAssessmentsTool: ToolConfig<
  CheckrReportIdParams,
  CheckrListAssessmentsResponse
> = {
  id: 'checkr_list_assessments',
  name: 'Checkr List Assessments',
  description:
    'List the Assess results for a report, including the ruleset applied and which rule flagged each record. Requires Checkr Assess.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/assessments`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        assessments: toArray(data.data).map((value) => {
          const assessment = toRecord(value)
          return {
            value: typeof assessment.value === 'string' ? assessment.value : null,
            createdAt: typeof assessment.created_at === 'string' ? assessment.created_at : null,
            ruleset: toRecordOrNull(assessment.ruleset),
            results: toArray(assessment.results).map((result) => toRecord(result)),
          }
        }),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    assessments: {
      type: 'array',
      description: 'Assessments for the report',
      items: {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            description: 'Assessment value (eligible, review, escalated)',
            nullable: true,
          },
          createdAt: {
            type: 'string',
            description: 'Time the assessment was made',
            nullable: true,
          },
          ruleset: {
            type: 'json',
            description: 'Ruleset applied (id, name, version with number)',
            nullable: true,
          },
          results: {
            type: 'json',
            description:
              'Rule results, each with value, assessed_objects (object_id, object_type), and rule (name, type)',
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of assessments', nullable: true },
  },
}
