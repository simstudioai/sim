import { ToolConfig } from '../types'
import { GoogleDocsToolParams, GoogleDocsWriteResponse } from './types'

export const writeTool: ToolConfig<GoogleDocsToolParams, GoogleDocsWriteResponse> = {
  id: 'google_docs_write',
  name: 'Write to Google Docs Document',
  description: 'Write or update content in a Google Docs document',
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
    documentId: { type: 'string', required: true },
    content: { type: 'string', required: true },
  },
  request: {
    url: (params) => {
      // Ensure documentId is valid
      const documentId = params.documentId?.trim()
      if (!documentId) {
        throw new Error('Document ID is required')
      }

      return `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`
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
      // Validate content
      if (!params.content) {
        throw new Error('Content is required')
      }

      // Create a batch update request to replace all content
      return {
        requests: [
          {
            // First, delete all existing content
            deleteContentRange: {
              range: {
                startIndex: 1, // Start after the initial paragraph marker
                endIndex: 999999, // A large number to ensure all content is deleted
              },
            },
          },
          {
            // Then insert the new content
            insertText: {
              location: {
                index: 1, // Insert after the initial paragraph marker
              },
              text: params.content,
            },
          },
        ],
      }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to write to Google Docs document: ${errorText}`)
    }

    const data = await response.json()

    // Get the document ID from the URL
    const urlParts = response.url.split('/')
    const documentId = urlParts[urlParts.length - 2].split(':')[0]

    // Create document metadata
    const metadata = {
      documentId,
      title: 'Updated Document', // We don't get the title back from the batchUpdate endpoint
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${documentId}/edit`,
    }

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },
  transformError: (error) => {
    if (typeof error === 'object' && error !== null) {
      return JSON.stringify(error) || 'An error occurred while writing to Google Docs'
    }
    return error.message || 'An error occurred while writing to Google Docs'
  },
}
