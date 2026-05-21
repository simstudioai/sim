import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdatePageElementAltTextTool')

interface UpdatePageElementAltTextParams {
  accessToken: string
  presentationId: string
  objectId: string
  title?: string
  description?: string
}

interface UpdatePageElementAltTextResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const updatePageElementAltTextTool: ToolConfig<
  UpdatePageElementAltTextParams,
  UpdatePageElementAltTextResponse
> = {
  id: 'google_slides_update_page_element_alt_text',
  name: 'Update Alt Text in Google Slides',
  description:
    'Set the accessibility title and/or description (alt text) of a page element such as an image, shape, or group.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

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
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the page element',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accessibility title for the element',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accessibility description (alt text) for the element',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')

      const updateRequest: Record<string, unknown> = { objectId }
      if (params.title !== undefined) updateRequest.title = params.title
      if (params.description !== undefined) updateRequest.description = params.description

      return { requests: [{ updatePageElementAltText: updateRequest }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update alt text')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        updated: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    updated: { type: 'boolean', description: 'Whether alt text was updated' },
    objectId: { type: 'string', description: 'The element updated' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
