import type {
  JotformCreateSubmissionsParams,
  JotformCreateSubmissionsResponse,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  isRecord,
  parseJotformResponse,
  requireValue,
  toJsonArray,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createSubmissionsTool: ToolConfig<
  JotformCreateSubmissionsParams,
  JotformCreateSubmissionsResponse
> = {
  id: 'jotform_create_submissions',
  name: 'Jotform Create Submissions',
  description:
    'Submit several entries to a Jotform form in one call. Each entry is keyed by question ID.',
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
      description: 'ID of the form to submit to',
    },
    submissions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of submissions. Each entry maps a question ID to an object holding its answer, e.g. [{"1":{"text":"Answer 1"},"2":{"text":"Answer 2"}}]',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/submissions`
      ).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    /**
     * Unlike the single-submission POST, the bulk endpoint takes a bare JSON array
     * rather than form-encoded `submission[...]` keys or a named envelope.
     */
    body: (params) => {
      const submissions = toJsonArray(params.submissions, 'submissions')
      if (submissions.length === 0) {
        throw new Error('submissions must contain at least one entry.')
      }
      return submissions
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Submissions')
    const entries = Array.isArray(envelope.content) ? envelope.content : []

    const created = entries.filter(isRecord).map((entry) => ({
      submissionId: toStringOrNull(entry.submissionID),
      url: toStringOrNull(entry.URL),
    }))

    return {
      success: true,
      output: {
        submissions: created,
        count: created.length,
      },
    }
  },

  outputs: {
    submissions: {
      type: 'array',
      description: 'The submissions that were created',
      items: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', description: 'ID of the created submission' },
          url: { type: 'string', description: 'API URL of the created submission' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of submissions created',
    },
  },
}
