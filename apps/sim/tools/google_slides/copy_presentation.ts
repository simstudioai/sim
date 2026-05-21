import { createLogger } from '@sim/logger'
import { presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCopyPresentationTool')

interface CopyPresentationParams {
  accessToken: string
  sourcePresentationId: string
  title?: string
  folderId?: string
}

interface CopyPresentationResponse {
  success: boolean
  output: {
    presentationId: string
    title: string
    metadata: {
      sourcePresentationId: string
      presentationId: string
      title: string
      mimeType: string
      url: string
    }
  }
}

const PRESENTATION_MIME = 'application/vnd.google-apps.presentation'

export const copyPresentationTool: ToolConfig<CopyPresentationParams, CopyPresentationResponse> = {
  id: 'google_slides_copy_presentation',
  name: 'Copy Google Slides Presentation',
  description:
    'Copy a template presentation in Drive to a new file. Use this before merging data so the original template is never modified.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides / Drive API',
    },
    sourcePresentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Drive file ID of the source/template presentation',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title for the copy. Defaults to "Copy of <source title>".',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Drive folder ID where the copy should be placed',
    },
  },

  request: {
    url: (params) => {
      const sourceId = params.sourcePresentationId?.trim()
      if (!sourceId) throw new Error('Source presentation ID is required')
      return `https://www.googleapis.com/drive/v3/files/${sourceId}/copy?supportsAllDrives=true`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) throw new Error('Access token is required')
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.title?.trim()) body.name = params.title.trim()
      if (params.folderId?.trim()) body.parents = [params.folderId.trim()]
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Drive API error during copy:', { data })
      throw new Error(data.error?.message || 'Failed to copy presentation')
    }
    const presentationId: string = data.id
    const title: string = data.name || 'Untitled Presentation'
    return {
      success: true,
      output: {
        presentationId,
        title,
        metadata: {
          sourcePresentationId: params?.sourcePresentationId?.trim() || '',
          presentationId,
          title,
          mimeType: PRESENTATION_MIME,
          url: presentationUrl(presentationId),
        },
      },
    }
  },

  outputs: {
    presentationId: { type: 'string', description: 'ID of the new copied presentation' },
    title: { type: 'string', description: 'Title of the new presentation' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        sourcePresentationId: { type: 'string', description: 'Source/template presentation ID' },
        presentationId: { type: 'string', description: 'New presentation ID' },
        title: { type: 'string', description: 'New presentation title' },
        mimeType: { type: 'string', description: 'MIME type of the presentation' },
        url: { type: 'string', description: 'URL to the new presentation' },
      },
    },
  },
}
