import {
  ADVERSE_ACTION_PROPERTIES,
  type CheckrAdverseActionResponse,
  type CheckrCreateAdverseActionParams,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapAdverseAction,
  parseCheckrObject,
  parseCheckrStringList,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateAdverseActionTool: ToolConfig<
  CheckrCreateAdverseActionParams,
  CheckrAdverseActionResponse
> = {
  id: 'checkr_create_adverse_action',
  name: 'Checkr Create Adverse Action',
  description:
    'Start the adverse action process on a report by sending the pre-adverse action notice. The report must have a consider result and no active adverse action.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report the adverse action is based on',
    },
    adverseItemIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'IDs of the adverse items to cite, as an array or comma-separated list (from List Adverse Items)',
    },
    postNoticeScheduledAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 8601 time to send the post-adverse action notice; defaults to 7 days after creation',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional scoping identifier for the adverse action',
    },
    medium: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Delivery channels as a JSON object, e.g. {"email":{"priority":1,"required":true},"postal":{"priority":0,"required":false}}',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/adverse_actions`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const adverseItemIds = parseCheckrStringList(params.adverseItemIds)
      if (!adverseItemIds?.length) {
        throw new Error('Provide at least one adverse item ID.')
      }
      const body: Record<string, unknown> = { adverse_item_ids: adverseItemIds }
      const scheduledAt = trimmed(params.postNoticeScheduledAt)
      if (scheduledAt) body.post_notice_scheduled_at = scheduledAt
      const context = trimmed(params.context)
      if (context) body.context = context
      const medium = parseCheckrObject(params.medium, 'medium')
      if (medium) body.medium = medium
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { adverseAction: mapAdverseAction(data) } }
  },

  outputs: {
    adverseAction: {
      type: 'object',
      description: 'The created adverse action',
      properties: ADVERSE_ACTION_PROPERTIES,
    },
  },
}
