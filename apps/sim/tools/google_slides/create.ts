import { createLogger } from '@sim/logger'
import type {
  GoogleSlidesCreateResponse,
  GoogleSlidesToolParams,
} from '@/tools/google_slides/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateTool')

export const createTool: ToolConfig<GoogleSlidesToolParams, GoogleSlidesCreateResponse> = {
  id: 'google_slides_create',
  name: 'Create Google Slides Presentation',
  description: 'Create a new Google Slides presentation',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the presentation to create',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The content to add to the first slide',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Drive folder ID to create the presentation in (e.g., 1ABCxyz...)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to create the presentation in (internal use)',
    },
  },

  request: {
    url: () => {
      return 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true'
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
        mimeType: 'application/vnd.google-apps.presentation',
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

    const presentationId = result.output.metadata.presentationId

    if (params.content && presentationId) {
      try {
        const writeParams = {
          accessToken: params.accessToken,
          presentationId: presentationId,
          content: params.content,
        }

        const writeResult = await executeTool('google_slides_write', writeParams)

        if (!writeResult.success) {
          logger.warn(
            'Failed to add content to presentation, but presentation was created:',
            writeResult.error
          )
        }
      } catch (error) {
        logger.warn('Error adding content to presentation:', { error })
        // Don't fail the overall operation if adding content fails
      }
    }

    return result
  },

  transformResponse: async (response: Response) => {
    try {
      // Get the response data
      const responseText = await response.text()
      const data = JSON.parse(responseText)

      const presentationId = data.id
      const title = data.name

      const metadata = {
        presentationId,
        title: title || 'Untitled Presentation',
        mimeType: 'application/vnd.google-apps.presentation',
        url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      }

      return {
        success: true,
        output: {
          metadata,
        },
      }
    } catch (error) {
      logger.error('Google Slides create - Error processing response:', {
        error,
      })
      throw error
    }
  },

  outputs: {
    metadata: {
      type: 'json',
      description: 'Created presentation metadata including ID, title, and URL',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        title: {
          type: 'string',
          description: 'The presentation title',
        },
        mimeType: {
          type: 'string',
          description: 'The mime type of the presentation',
        },
        url: {
          type: 'string',
          description: 'URL to open the presentation',
        },
      },
    },
  },
}
