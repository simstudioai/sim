import type { ToolConfig } from '../types'
import type { TypeformFilesParams, TypeformFilesResponse } from './types'

export const filesTool: ToolConfig<TypeformFilesParams, TypeformFilesResponse> = {
  id: 'typeform_files',
  name: 'Typeform Files',
  description: 'Download files uploaded in Typeform responses',
  version: '1.0.0',
  params: {
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform form ID',
    },
    responseId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Response ID containing the files',
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
    url: (params: TypeformFilesParams) => {
      const encodedFormId = encodeURIComponent(params.formId)
      const encodedResponseId = encodeURIComponent(params.responseId)
      const encodedFieldId = encodeURIComponent(params.fieldId)
      const encodedFilename = encodeURIComponent(params.filename)

      let url = `https://api.typeform.com/forms/${encodedFormId}/responses/${encodedResponseId}/fields/${encodedFieldId}/files/${encodedFilename}`

      // Add the inline parameter if provided
      if (params.inline !== undefined) {
        url += `?inline=${params.inline}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response: Response, params?: TypeformFilesParams) => {
    if (!response.ok) {
      let errorMessage = response.statusText || 'Unknown error'

      try {
        const errorData = await response.json()
        if (errorData?.message) {
          errorMessage = errorData.message
        } else if (errorData?.description) {
          errorMessage = errorData.description
        } else if (typeof errorData === 'string') {
          errorMessage = errorData
        }
      } catch (_e) {
        // If we can't parse the error as JSON, just use the status text
      }

      throw new Error(`Typeform API error (${response.status}): ${errorMessage}`)
    }

    // For file downloads, we get the file directly
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition') || ''

    // Try to extract filename from content-disposition if possible
    let filename = ''
    const filenameMatch = contentDisposition.match(/filename="(.+?)"/)
    if (filenameMatch?.[1]) {
      filename = filenameMatch[1]
    }

    // Get file URL from the response URL or construct it from parameters if not available
    let fileUrl = response.url

    // If the response URL is not available (common in test environments), construct it from params
    if (!fileUrl && params) {
      const encodedFormId = encodeURIComponent(params.formId)
      const encodedResponseId = encodeURIComponent(params.responseId)
      const encodedFieldId = encodeURIComponent(params.fieldId)
      const encodedFilename = encodeURIComponent(params.filename)

      fileUrl = `https://api.typeform.com/forms/${encodedFormId}/responses/${encodedResponseId}/fields/${encodedFieldId}/files/${encodedFilename}`

      if (params.inline !== undefined) {
        fileUrl += `?inline=${params.inline}`
      }
    }

    return {
      success: true,
      output: {
        fileUrl: fileUrl || '',
        contentType,
        filename,
      },
    }
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return `Failed to retrieve Typeform file: ${error.message}`
    }

    if (typeof error === 'object' && error !== null) {
      return `Failed to retrieve Typeform file: ${JSON.stringify(error)}`
    }

    return 'Failed to retrieve Typeform file: An unknown error occurred'
  },
}
