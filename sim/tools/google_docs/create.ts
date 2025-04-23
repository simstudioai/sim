import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { GoogleDocsCreateResponse, GoogleDocsToolParams } from './types'

const logger = createLogger('Google Docs Create Tool')

export const createTool: ToolConfig<GoogleDocsToolParams, GoogleDocsCreateResponse> = {
  id: 'google_docs_create',
  name: 'Create Google Docs Document',
  description: 'Create a new Google Docs document',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-docs',
    additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
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
  postProcess: async (result, params, executeTool) => {
    // Only add content if it was provided and not already added during creation
    // The Google Docs API doesn't directly support content in the create request,
    // so we need to add it separately via the write tool
    if (result.success && params.content) {
      const documentId = result.output.metadata.documentId

      if (documentId) {
        try {
          const writeParams = {
            accessToken: params.accessToken,
            documentId: documentId,
            content: params.content,
          }

          // Use the write tool to add content
          const writeResult = await executeTool('google_docs_write', writeParams)

          if (!writeResult.success) {
            logger.warn(
              'Failed to add content to document, but document was created:',
              writeResult.error
            )
          }
        } catch (error) {
          logger.warn('Error adding content to document:', { error })
          // Don't fail the overall operation if adding content fails
        }
      }
    }

    // Return the original result regardless of post-processing outcome
    return result
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
      logger.error('Google Docs create - Error processing response:', {
        error,
      })
      throw error
    }
  },
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while creating Google Docs document'
  },
}
