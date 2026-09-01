import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  ashbyTimestamp,
  USER_SUMMARY_OUTPUT,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  applicationId?: string
  cursor?: string
  perPage?: number
  syncToken?: string
  createdAfter?: string
}
interface Response extends ToolResponse {
  output: {
    feedback: unknown[]
    moreDataAvailable: boolean
    nextCursor: string | null
    nextSyncCursor: string | null
  }
}
export const listApplicationFeedbackTool: ToolConfig<Params, Response> = {
  id: 'ashby_list_application_feedback',
  name: 'Ashby List Application Feedback',
  description:
    'Lists submitted interview feedback, optionally for one application, with pagination and incremental sync.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    applicationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application UUID',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a completed prior sync run',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only feedback submitted after this ISO 8601 timestamp',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/applicationFeedback.list',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({
      ...(p.applicationId ? { applicationId: p.applicationId.trim() } : {}),
      ...(p.cursor ? { cursor: p.cursor } : {}),
      ...(ashbyLimit(p.perPage) ? { limit: ashbyLimit(p.perPage) } : {}),
      ...(p.syncToken ? { syncToken: p.syncToken } : {}),
      ...(p.createdAfter ? { createdAfter: ashbyTimestamp(p.createdAfter, 'createdAfter') } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success)
      throw new Error(ashbyErrorMessage(data, 'Failed to list application feedback'))
    return {
      success: true,
      output: {
        feedback: data.results ?? [],
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        nextSyncCursor: data.syncToken ?? null,
      },
    }
  },
  outputs: {
    feedback: {
      type: 'array',
      description: 'Submitted application feedback',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Feedback UUID' },
          formDefinition: {
            type: 'json',
            description: 'Feedback form sections and documented field definitions',
          },
          feedbackFormDefinitionId: {
            type: 'string',
            description: 'Feedback form definition UUID',
            optional: true,
          },
          applicationId: { type: 'string', description: 'Application UUID' },
          submittedValues: {
            type: 'json',
            description: 'Submitted field values keyed by form field path',
          },
          submittedByUser: USER_SUMMARY_OUTPUT,
          creditedToUser: USER_SUMMARY_OUTPUT,
          interviewId: { type: 'string', description: 'Interview UUID', optional: true },
          interviewEventId: { type: 'string', description: 'Interview event UUID', optional: true },
          applicationHistoryId: {
            type: 'string',
            description: 'Application history UUID',
            optional: true,
          },
          submittedAt: { type: 'string', description: 'Submission timestamp' },
        },
      },
    },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Next page cursor', optional: true },
    nextSyncCursor: { type: 'string', description: 'Next incremental sync token', optional: true },
  },
}
