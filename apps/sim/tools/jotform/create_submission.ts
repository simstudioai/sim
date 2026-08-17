import { unwrapSingle } from '@/tools/jotform/normalize'
import type {
  JotformCreateSubmissionParams,
  JotformSubmissionRefResponse,
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

export const createSubmissionTool: ToolConfig<
  JotformCreateSubmissionParams,
  JotformSubmissionRefResponse
> = {
  id: 'jotform_create_submission',
  name: 'Jotform Create Submission',
  description:
    'Submit an entry to a Jotform form. Answers are keyed by question ID, which the List Questions operation returns.',
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
    answers: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Answers keyed by question ID. Multi-field questions take either a nested object or the documented shorthand, e.g. {"3":{"first":"Bart","last":"Simpson"},"4":"Hello"} or {"3_first":"Bart","3_last":"Simpson"}',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/submissions`
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
    const envelope = await parseJotformResponse(response, 'Jotform Create Submission')
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
      description: 'ID of the submission that was created',
    },
    url: {
      type: 'string',
      description: 'API URL of the new submission',
      optional: true,
    },
  },
}
