import { createLogger } from '@sim/logger'
import type { GoogleSlidesToolParams, GoogleSlidesWriteResponse } from '@/tools/google_slides/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesWriteTool')

export const writeTool: ToolConfig<GoogleSlidesToolParams, GoogleSlidesWriteResponse> = {
  id: 'google_slides_write',
  name: 'Write to Google Slides Presentation',
  description: 'Write or update content in a Google Slides presentation',
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
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to write to the slide',
    },
    slideIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The index of the slide to write to (defaults to first slide)',
    },
  },

  request: {
    url: (params) => {
      // Ensure presentationId is valid
      const presentationId = params.presentationId?.trim() || params.manualPresentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }

      // First, we'll read the presentation to get slide information
      return `https://slides.googleapis.com/v1/presentations/${presentationId}`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  postProcess: async (result, params, _executeTool) => {
    if (!result.success) {
      return result
    }

    // Validate content
    if (!params.content) {
      throw new Error('Content is required')
    }

    const presentationId = params.presentationId?.trim() || params.manualPresentationId?.trim()

    if (!presentationId) {
      throw new Error('Presentation ID is required')
    }

    try {
      // Get the presentation data from the initial read
      const presentationData = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
          },
        }
      ).then((res) => res.json())

      const metadata = {
        presentationId,
        title: presentationData.title || 'Updated Presentation',
        mimeType: 'application/vnd.google-apps.presentation',
        url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      }

      const slideIndex =
        typeof params.slideIndex === 'string'
          ? Number.parseInt(params.slideIndex, 10)
          : (params.slideIndex ?? 0)
      const slide = presentationData.slides?.[slideIndex]

      if (Number.isNaN(slideIndex) || slideIndex < 0) {
        return {
          success: false,
          error: 'Slide index must be a non-negative number',
          output: {
            updatedContent: false,
            metadata,
          },
        }
      }

      if (!slide) {
        return {
          success: false,
          error: `Slide at index ${slideIndex} not found`,
          output: {
            updatedContent: false,
            metadata,
          },
        }
      }

      // Create requests to add content to the slide
      const textBoxId = `textbox_${Date.now()}`
      const requests = [
        {
          createShape: {
            objectId: textBoxId,
            shapeType: 'TEXT_BOX',
            elementProperties: {
              pageObjectId: slide.objectId,
              size: {
                width: {
                  magnitude: 400,
                  unit: 'PT',
                },
                height: {
                  magnitude: 100,
                  unit: 'PT',
                },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: 50,
                translateY: 100,
                unit: 'PT',
              },
            },
          },
        },
        {
          insertText: {
            objectId: textBoxId,
            text: params.content,
            insertionIndex: 0,
          },
        },
      ]

      // Make the batchUpdate request
      const updateResponse = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
        }
      )

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        logger.error('Failed to update presentation:', { errorText })
        return {
          success: false,
          error: 'Failed to update presentation',
          output: {
            updatedContent: false,
            metadata,
          },
        }
      }

      return {
        success: true,
        output: {
          updatedContent: true,
          metadata,
        },
      }
    } catch (error) {
      logger.error('Error in postProcess:', { error })
      throw error
    }
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Indicates if presentation content was updated successfully',
    },
    metadata: {
      type: 'json',
      description: 'Updated presentation metadata including ID, title, and URL',
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

  transformResponse: async (response: Response) => {
    // This is just for the initial read, the actual response comes from postProcess
    const data = await response.json()

    const metadata = {
      presentationId: data.presentationId,
      title: data.title || 'Presentation',
      mimeType: 'application/vnd.google-apps.presentation',
      url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
    }

    return {
      success: true,
      output: {
        updatedContent: false,
        metadata,
      },
    }
  },
}
