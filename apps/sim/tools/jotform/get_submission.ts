import { normalizeSubmission, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetSubmissionParams, JotformSubmissionResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getSubmissionTool: ToolConfig<JotformGetSubmissionParams, JotformSubmissionResponse> =
  {
    id: 'jotform_get_submission',
    name: 'Jotform Get Submission',
    description:
      'Get a single Jotform submission, with its answers available both by question ID and by question label.',
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
      submissionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the submission to read',
      },
    },

    request: {
      url: (params) =>
        buildJotformUrl(
          params,
          `submission/${encodeURIComponent(requireValue(params.submissionId, 'submissionId'))}`
        ).toString(),
      method: 'GET',
      headers: (params) => buildJotformHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const envelope = await parseJotformResponse(response, 'Jotform Get Submission')
      const raw = unwrapSingle(envelope.content)
      if (!raw) throw new Error('Jotform Get Submission returned no submission.')

      return {
        success: true,
        output: { submission: normalizeSubmission(raw) },
      }
    },

    outputs: {
      submission: {
        type: 'object',
        description: 'The requested submission',
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
  }
