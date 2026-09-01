import type { JotformDeleteSubmissionParams, JotformMessageResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteSubmissionTool: ToolConfig<
  JotformDeleteSubmissionParams,
  JotformMessageResponse
> = {
  id: 'jotform_delete_submission',
  name: 'Jotform Delete Submission',
  description: 'Delete a single Jotform submission.',
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
      description: 'ID of the submission to delete',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `submission/${encodeURIComponent(requireValue(params.submissionId, 'submissionId'))}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Submission')

    return {
      success: true,
      output: {
        deleted: true,
        message: toStringOrNull(envelope.content) ?? envelope.message,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'True when Jotform accepted the deletion',
    },
    message: {
      type: 'string',
      description: 'Confirmation text returned by Jotform',
      optional: true,
    },
  },
}
