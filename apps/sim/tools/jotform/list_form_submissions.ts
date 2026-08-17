import { normalizeSubmission, toList } from '@/tools/jotform/normalize'
import type {
  JotformListFormSubmissionsParams,
  JotformListSubmissionsResponse,
} from '@/tools/jotform/types'
import {
  applyListQuery,
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listFormSubmissionsTool: ToolConfig<
  JotformListFormSubmissionsParams,
  JotformListSubmissionsResponse
> = {
  id: 'jotform_list_form_submissions',
  name: 'Jotform List Form Submissions',
  description:
    'List the submissions received by one form, with each answer available both by question ID and by question label.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the form whose submissions to list',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first result to return. Default 0',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of submissions to return. Default 20, maximum 1000',
    },
    orderby: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to order by: id, form_id, IP, created_at, status, new, flag, or updated_at',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC',
    },
    filter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter object, e.g. {"created_at:gt":"2024-01-01 00:00:00"}, {"new":"1"}, or {"fullText":"John Brown"}',
    },
  },

  request: {
    url: (params) => {
      const url = buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/submissions`
      )
      applyListQuery(url, params)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Form Submissions')

    return {
      success: true,
      output: {
        submissions: toList(envelope.content).map(normalizeSubmission),
        pagination: envelope.resultSet,
      },
    }
  },

  outputs: {
    submissions: {
      type: 'array',
      description: 'Submissions received by the form',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Submission ID' },
          form_id: { type: 'string', description: 'Form the submission belongs to' },
          ip: { type: 'string', description: 'IP address of the submitter' },
          created_at: { type: 'string', description: 'Submission time, YYYY-MM-DD HH:MM:SS' },
          updated_at: { type: 'string', description: 'Last edit time, YYYY-MM-DD HH:MM:SS' },
          status: { type: 'string', description: 'ACTIVE or OVERQUOTA' },
          new: { type: 'string', description: '1 when the submission is unread' },
          workflowStatus: {
            type: 'string',
            description: 'Approval state, present only when the form feeds a workflow',
          },
          answers: {
            type: 'json',
            description:
              'Answers keyed by question ID. Each holds text (the question label), type, answer, and prettyFormat when Jotform renders one.',
          },
          values: {
            type: 'json',
            description:
              'The same answers re-keyed by question label, each rendered as a single string. A label shared by more than one question is suffixed with its question ID on every occurrence, so no answer is lost.',
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Result window reported by the API',
      optional: true,
      properties: {
        offset: { type: 'number', description: 'Index of the first returned submission' },
        limit: { type: 'number', description: 'Page size applied' },
        count: { type: 'number', description: 'Number of submissions returned' },
      },
    },
  },
}
