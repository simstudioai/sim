import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { GenerateImage } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { getServePathPrefix } from '@/lib/uploads'
import {
  downloadWorkspaceFile,
  getWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('GenerateImageTool')

const NANO_BANANA_MODEL = 'gemini-3.1-flash-image-preview'
const NANO_BANANA_IMAGE_COST_USD = 0.101

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1024x768',
  '3:4': '768x1024',
}

function validateGeneratedWorkspaceFileName(fileName: string): string | null {
  const trimmed = fileName.trim()
  if (!trimmed) return 'File name cannot be empty'
  if (trimmed.includes('/')) {
    return 'Workspace files use a flat namespace. Use a plain file name like "generated-image.png", not a path like "images/generated-image.png".'
  }
  return null
}

interface GenerateImageArgs {
  prompt: string
  referenceFileIds?: string[]
  aspectRatio?: string
  fileName?: string
  overwriteFileId?: string
}

interface GenerateImageResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  downloadUrl?: string
  _serviceCost?: { service: string; cost: number }
}

export const generateImageServerTool: BaseServerTool<GenerateImageArgs, GenerateImageResult> = {
  name: GenerateImage.id,

  async execute(
    params: GenerateImageArgs,
    context?: ServerToolContext
  ): Promise<GenerateImageResult> {
    const withMessageId = (message: string) =>
      context?.messageId ? `${message} [messageId:${context.messageId}]` : message

    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const { prompt } = params
    if (!prompt) {
      return { success: false, message: 'prompt is required' }
    }

    try {
      const apiKey = getRotatingApiKey('gemini')
      const ai = new GoogleGenAI({ apiKey })

      const aspectRatio = params.aspectRatio || '1:1'
      const sizeHint = ASPECT_RATIO_TO_SIZE[aspectRatio]

      const parts: Part[] = []
      const referenceRecords: Array<{ id: string; name: string }> = []

      if (params.referenceFileIds?.length) {
        for (const fileId of params.referenceFileIds) {
          try {
            const fileRecord = await getWorkspaceFile(workspaceId, fileId)
            if (fileRecord) {
              referenceRecords.push({ id: fileRecord.id, name: fileRecord.name })
              const buffer = await downloadWorkspaceFile(fileRecord)
              const base64 = buffer.toString('base64')
              const mime = fileRecord.type || 'image/png'
              parts.push({
                inlineData: { mimeType: mime, data: base64 },
              })
              logger.info('Loaded reference image', {
                fileId,
                name: fileRecord.name,
                size: buffer.length,
                mimeType: mime,
              })
            } else {
              logger.warn('Reference file not found, skipping', { fileId })
            }
          } catch (err) {
            logger.warn('Failed to load reference image, skipping', {
              fileId,
              error: toError(err).message,
            })
          }
        }
      }

      const sizeInstruction = sizeHint
        ? ` Generate the image at ${sizeHint} resolution with a ${aspectRatio} aspect ratio.`
        : ''

      parts.push({ text: prompt + sizeInstruction })

      logger.info('Generating image with Nano Banana 2', {
        model: NANO_BANANA_MODEL,
        aspectRatio,
        promptLength: prompt.length,
        referenceImageCount: params.referenceFileIds?.length ?? 0,
      })

      const response = await ai.models.generateContent({
        model: NANO_BANANA_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      })

      let imageBase64: string | undefined
      let mimeType = 'image/png'

      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data
            if (part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType
            }
            break
          }
        }
      }

      if (!imageBase64) {
        const textParts = response.candidates?.[0]?.content?.parts
          ?.filter((p) => p.text)
          .map((p) => p.text)
          .join(' ')
        return {
          success: false,
          message: `Image generation returned no image data. ${textParts ? `Model response: ${textParts.slice(0, 500)}` : 'No response from model.'}`,
        }
      }

      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png'
      const fileName = params.fileName || `generated-image${ext}`
      const fileNameValidationError = validateGeneratedWorkspaceFileName(fileName)
      if (fileNameValidationError) {
        return { success: false, message: fileNameValidationError }
      }
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      const inferredOverwriteFileId =
        !params.overwriteFileId && params.fileName
          ? referenceRecords.find((record) => record.name === fileName)?.id
          : undefined
      const overwriteFileId = params.overwriteFileId ?? inferredOverwriteFileId

      if (inferredOverwriteFileId) {
        logger.info('Inferring overwrite target from referenced file name', {
          fileName,
          overwriteFileId: inferredOverwriteFileId,
        })
      }

      if (overwriteFileId) {
        const existing = await getWorkspaceFile(workspaceId, overwriteFileId)
        if (!existing) {
          return {
            success: false,
            message: `File not found for overwrite: ${overwriteFileId}`,
          }
        }
        assertServerToolNotAborted(context)
        const updated = await updateWorkspaceFileContent(
          workspaceId,
          overwriteFileId,
          context.userId,
          imageBuffer,
          mimeType
        )
        logger.info('Generated image overwritten', {
          fileId: updated.id,
          fileName: updated.name,
          size: imageBuffer.length,
          mimeType,
        })
        const pathPrefix = getServePathPrefix()
        return {
          success: true,
          message: `Image ${params.referenceFileIds?.length ? 'edited' : 'generated'} and updated in "${updated.name}" (${imageBuffer.length} bytes)`,
          fileId: updated.id,
          fileName: updated.name,
          downloadUrl: `${pathPrefix}${encodeURIComponent(updated.key)}?context=workspace`,
          _serviceCost: { service: 'nano_banana_2', cost: NANO_BANANA_IMAGE_COST_USD },
        }
      }

      assertServerToolNotAborted(context)
      const uploaded = await uploadWorkspaceFile(
        workspaceId,
        context.userId,
        imageBuffer,
        fileName,
        mimeType
      )

      logger.info('Generated image saved', {
        fileId: uploaded.id,
        fileName: uploaded.name,
        size: imageBuffer.length,
        mimeType,
      })

      return {
        success: true,
        message: `Image ${params.referenceFileIds?.length ? 'edited' : 'generated'} and saved as "${uploaded.name}" (${imageBuffer.length} bytes)`,
        fileId: uploaded.id,
        fileName: uploaded.name,
        downloadUrl: uploaded.url,
        _serviceCost: { service: 'nano_banana_2', cost: NANO_BANANA_IMAGE_COST_USD },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Image generation failed', { error: msg })
      return { success: false, message: `Failed to generate image: ${msg}` }
    }
  },
}
