import { normalizeFile, toList } from '@/tools/jotform/normalize'
import type { JotformGetFormFilesParams, JotformGetFormFilesResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listFormFilesTool: ToolConfig<JotformGetFormFilesParams, JotformGetFormFilesResponse> =
  {
    id: 'jotform_list_form_files',
    name: 'Jotform List Form Files',
    description:
      'List every file uploaded through a form, with its download URL, size, type, and the submission it came from.',
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
        description: 'ID of the form whose uploads to list',
      },
    },

    request: {
      url: (params) =>
        buildJotformUrl(
          params,
          `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/files`
        ).toString(),
      method: 'GET',
      headers: (params) => buildJotformHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const envelope = await parseJotformResponse(response, 'Jotform List Form Files')

      return {
        success: true,
        output: {
          files: toList(envelope.content).map(normalizeFile),
        },
      }
    },

    outputs: {
      files: {
        type: 'array',
        description: 'Files uploaded through the form',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            type: { type: 'string', description: 'MIME type, e.g. image/png' },
            size: { type: 'string', description: 'File size in bytes' },
            username: { type: 'string', description: 'Account that owns the form' },
            form_id: { type: 'string', description: 'Form the file was uploaded through' },
            submission_id: { type: 'string', description: 'Submission the file belongs to' },
            date: { type: 'string', description: 'Upload time, YYYY-MM-DD HH:MM:SS' },
            url: { type: 'string', description: 'Download URL for the file' },
          },
        },
      },
    },
  }
