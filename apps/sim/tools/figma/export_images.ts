import { createLogger } from '@/lib/logs/console/logger'
import type {
  FigmaExportedFile,
  FigmaExportImagesParams,
  FigmaExportImagesResponse,
} from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FigmaExportImagesTool')

const FORMAT_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
}

export const figmaExportImagesTool: ToolConfig<FigmaExportImagesParams, FigmaExportImagesResponse> =
  {
    id: 'figma_export_images',
    name: 'Figma - Export Images',
    description: 'Export images from specific nodes in a Figma file as PNG, SVG, PDF, or JPG',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'figma',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token',
      },
      fileKey: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The key of the Figma file (from the URL: figma.com/file/{fileKey}/...)',
      },
      nodeIds: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of node IDs to export as images',
      },
      format: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Image format: png, svg, pdf, or jpg',
      },
      scale: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Scale factor for the image (0.01 to 4, default: 1)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = `https://api.figma.com/v1/images/${params.fileKey}`
        const queryParams = new URLSearchParams()

        queryParams.append('ids', params.nodeIds)
        queryParams.append('format', params.format)

        if (params.scale) {
          queryParams.append('scale', params.scale.toString())
        }

        return `${baseUrl}?${queryParams.toString()}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response, params) => {
      const data = await response.json()
      const images: Record<string, string> = data.images || {}
      const format = params?.format || 'png'
      const mimeType = FORMAT_MIME_TYPES[format] || 'image/png'

      const files: FigmaExportedFile[] = []

      for (const [nodeId, imageUrl] of Object.entries(images)) {
        if (!imageUrl) {
          logger.warn('No image URL for node', { nodeId })
          continue
        }

        try {
          logger.info('Downloading image', { nodeId, format })

          const imageResponse = await fetch(imageUrl)

          if (!imageResponse.ok) {
            logger.error('Failed to download image', {
              nodeId,
              status: imageResponse.status,
              statusText: imageResponse.statusText,
            })
            continue
          }

          const arrayBuffer = await imageResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          const sanitizedNodeId = nodeId.replace(/[^a-zA-Z0-9-_]/g, '_')
          const fileName = `figma_${sanitizedNodeId}.${format}`

          files.push({
            name: fileName,
            mimeType,
            data: buffer,
            size: buffer.length,
            nodeId,
          })

          logger.info('Image downloaded successfully', {
            nodeId,
            fileName,
            size: buffer.length,
          })
        } catch (error) {
          logger.error('Error downloading image', { nodeId, error })
        }
      }

      return {
        success: true,
        output: {
          files,
          metadata: {
            format,
            scale: params?.scale || 1,
            nodeCount: files.length,
          },
        },
      }
    },

    outputs: {
      files: {
        type: 'file[]',
        description: 'Exported image files stored in execution files',
      },
      metadata: {
        type: 'json',
        description: 'Export metadata including format, scale, and node count',
      },
    },
  }
