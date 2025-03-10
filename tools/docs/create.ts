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
    url: (params) => {
      // Build URL with query parameters to pass content and folderId
      const url = new URL('https://docs.googleapis.com/v1/documents')
      if (params.content) {
        url.searchParams.append('content', params.content)
      }
      if (params.folderId) {
        url.searchParams.append('folderId', params.folderId)
      }
      return url.toString()
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
        'X-Access-Token': params.accessToken, // Store access token in a custom header for later use
      }
    },
    body: (params) => {
      // Validate title
      if (!params.title) {
        throw new Error('Title is required')
      }

      // Create a new document with the specified title
      return {
        title: params.title,
      }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create Google Docs document: ${errorText}`)
    }

    const data = await response.json()
    const documentId = data.documentId

    // Get access token from the custom header we set in the request
    const accessToken = response.headers.get('X-Access-Token') || ''

    // Extract content and folderId from the request URL query parameters
    const requestUrl = new URL(response.url)
    const content = requestUrl.searchParams.get('content') || ''
    const folderId = requestUrl.searchParams.get('folderId') || ''

    // If content was provided, we need to update the document with content
    if (documentId && content) {
      try {
        // Make a second request to update the document with content
        const updateResponse = await fetch(
          `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  insertText: {
                    location: {
                      index: 1,
                    },
                    text: content,
                  },
                },
              ],
            }),
          }
        )

        if (!updateResponse.ok) {
          console.warn('Failed to update document with content, but document was created')
        }
      } catch (error) {
        console.warn('Error updating document with content:', error)
      }
    }

    // If folderId was provided, we need to move the document to that folder
    if (documentId && folderId) {
      try {
        // Make a request to the Drive API to move the file
        const moveResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${documentId}?addParents=${folderId}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        )

        if (!moveResponse.ok) {
          console.warn('Failed to move document to specified folder, but document was created')
        }
      } catch (error) {
        console.warn('Error moving document to folder:', error)
      }
    }

    // Create document metadata
    const metadata = {
      documentId: data.documentId,
      title: data.title || 'Untitled Document',
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${data.documentId}/edit`,
    }

    return {
      success: true,
      output: {
        metadata,
      },
    }
  },
  transformError: (error) => {
    if (typeof error === 'object' && error !== null) {
      return JSON.stringify(error) || 'An error occurred while creating Google Docs document'
    }
    return error.message || 'An error occurred while creating Google Docs document'
  },
}
