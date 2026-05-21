import type { TypeformFilesParams, TypeformFilesResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const filesTool: ToolConfig<TypeformFilesParams, TypeformFilesResponse> = {
  id: 'typeform_files',
  name: 'Typeform Files',
  description: 'Download files uploaded in Typeform responses',
  version: '1.0.0',

  params: {
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Typeform form ID (e.g., "abc123XYZ")',
    },
    responseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Response ID containing the files (e.g., "resp_xyz789")',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Unique ID of the file upload field',
    },
    filename: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Filename of the uploaded file',
    },
    inline: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to request the file with inline Content-Disposition',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
  },

  request: {
    url: '/api/tools/typeform/files',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      formId: params.formId,
      responseId: params.responseId,
      fieldId: params.fieldId,
      filename: params.filename,
      inline: params.inline,
      apiKey: params.apiKey,
      workspaceId:
        typeof params._context?.workspaceId === 'string' ? params._context.workspaceId : undefined,
      workflowId:
        typeof params._context?.workflowId === 'string' ? params._context.workflowId : undefined,
      executionId:
        typeof params._context?.executionId === 'string' ? params._context.executionId : undefined,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to download Typeform file')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    fileUrl: { type: 'string', description: 'Direct download URL for the uploaded file' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    contentType: { type: 'string', description: 'MIME type of the uploaded file' },
    filename: { type: 'string', description: 'Original filename of the uploaded file' },
  },
}
