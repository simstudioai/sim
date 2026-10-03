import { unwrapSingle } from '@/tools/jotform/normalize'
import type {
  JotformSubmissionRefResponse,
  JotformUpdateSubmissionParams,
} from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  normalizeSubmissionAnswers,
  parseJotformResponse,
  requireValue,
  toFormBody,
  toJsonObject,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSubmissionTool: ToolConfig<
  JotformUpdateSubmissionParams,
  JotformSubmissionRefResponse
> = {
  id: 'jotform_update_submission',
  name: 'Jotform Update Submission',
  description:
    'Edit an existing Jotform submission. Only the question IDs supplied are changed; the rest keep their stored answers.',
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
      description: 'ID of the submission to edit',
    },
    answers: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Answers to overwrite, keyed by question ID, e.g. {"4":"Updated message","3":{"first":"Lisa"}} or the shorthand {"3_first":"Lisa"}. The control keys new, flag, and status are passed through unchanged.',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `submission/${encodeURIComponent(requireValue(params.submissionId, 'submissionId'))}`
      ).toString(),
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => {
      const answers = toJsonObject(params.answers, 'answers')
      if (Object.keys(answers).length === 0) {
        throw new Error('answers must contain at least one question ID.')
      }
      return toFormBody({ submission: normalizeSubmissionAnswers(answers) })
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Update Submission')
    const raw = unwrapSingle(envelope.content) ?? {}

    return {
      success: true,
      output: {
        submissionId: toStringOrNull(raw.submissionID),
        url: toStringOrNull(raw.URL),
      },
    }
  },

  outputs: {
    submissionId: {
      type: 'string',
      description: 'ID of the submission that was edited',
    },
    url: {
      type: 'string',
      description: 'API URL of the submission',
      optional: true,
    },
  },
}
