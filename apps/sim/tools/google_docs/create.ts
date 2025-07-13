import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { GoogleDocsCreateResponse, GoogleDocsToolParams } from './types'

const logger = createLogger('GoogleDocsCreateTool')

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
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the document to create',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The content of the document to create',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the folder to create the document in',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to create the document in (internal use)',
    },
  },
  request: {
    url: () => {
      return 'https://www.googleapis.com/drive/v3/files'
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
      if (!params.title) {
        throw new Error('Title is required')
      }

      const requestBody: any = {
        name: params.title,
        mimeType: 'application/vnd.google-apps.document',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const folderId = params.folderSelector || params.folderId
      if (folderId) {
        requestBody.parents = [folderId]
      }

      return requestBody
    },
  },
  postProcess: async (result, params, executeTool) => {
    if (!result.success) {
      return result
    }

    const documentId = result.output.metadata.documentId

    if (params.content && documentId) {
      try {
        const writeParams = {
          accessToken: params.accessToken,
          documentId: documentId,
          content: params.content,
        }

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

    return result
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorText = ''
      try {
        const responseClone = response.clone()
        const responseText = await responseClone.text()
        errorText = responseText
      } catch (_e) {
        errorText = 'Unable to read error response'
      }

      throw new Error(`Failed to create Google Docs document (${response.status}): ${errorText}`)
    }

    try {
      // Get the response data
      const responseText = await response.text()
      const data = JSON.parse(responseText)

      const documentId = data.id
      const title = data.name

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
