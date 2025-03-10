import { ToolConfig } from '../types'
import { GoogleDocsCreateResponse, GoogleDocsToolParams } from './types'

export const createTool: ToolConfig<GoogleDocsToolParams, GoogleDocsCreateResponse> = {
  id: 'google_docs_create',
  name: 'Create Google Docs Document',
  description: 'Create a new Google Docs document',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-docs',
    additionalScopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ],
  },
  params: {
    accessToken: { type: 'string', required: true },
    title: { type: 'string', required: true },
    content: { type: 'string', required: false },
    folderId: { type: 'string', required: false },
  },
  request: {
    url: () => {
      return 'https://docs.googleapis.com/v1/documents'
    },
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Validate title
      if (!params.title) {
        throw new Error('Title is required')
      }

      // Create a new document with the specified title
      const requestBody = {
        title: params.title,
      }

      return requestBody
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorText = ''
      try {
        const responseClone = response.clone()
        const responseText = await responseClone.text()
        errorText = responseText
      } catch (e) {
        errorText = 'Unable to read error response'
      }

      throw new Error(`Failed to create Google Docs document (${response.status}): ${errorText}`)
    }

    try {
      // Get the response data
      const responseText = await response.text()
      const data = JSON.parse(responseText)
      const documentId = data.documentId
      const title = data.title

      // Create document metadata
      const metadata = {
        documentId,
        title: title || 'Untitled Document',
        mimeType: 'application/vnd.google-apps.document',
        url: `https://docs.google.com/document/d/${documentId}/edit`,
      }

      return {
        success: true,
        output: {
          metadata,
        },
      }
    } catch (error) {
      throw error
    }
  },
  transformError: (error) => {
    if (typeof error === 'object' && error !== null) {
      if (error.message) {
        return error.message
      }
      return (
        JSON.stringify(error, null, 2) || 'An error occurred while creating Google Docs document'
      )
    }

    return error.toString() || 'An error occurred while creating Google Docs document'
  },
}
