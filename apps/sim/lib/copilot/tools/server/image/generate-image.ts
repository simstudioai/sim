import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { GenerateImage } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  prepareMediaOutput,
  requireMediaFileDeclarations,
  resolveMediaInputFile,
} from '@/lib/copilot/tools/server/media/file-paths'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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

interface GenerateImageArgs {
  prompt: string
  inputs?: { files?: Array<{ path: string }> }
  aspectRatio?: string
  outputs?: {
    files?: Array<{
      path: string
      mode?: 'create' | 'overwrite'
      mimeType?: string
    }>
  }
}

interface GenerateImageResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  vfsPath?: string
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
      const outputFile = await prepareMediaOutput({
        output: params.outputs,
        workspaceId,
        userId: context.userId,
      })

      const apiKey = getRotatingApiKey('gemini')
      const ai = new GoogleGenAI({ apiKey })

      const aspectRatio = params.aspectRatio || '1:1'
      const sizeHint = ASPECT_RATIO_TO_SIZE[aspectRatio]

      const parts: Part[] = []

      const referencePaths = params.inputs
        ? requireMediaFileDeclarations(params.inputs.files, 'Input').map((file) => file.path)
        : []

      if (referencePaths.length) {
        for (const filePath of referencePaths) {
          const fileRecord = await resolveMediaInputFile({
            workspaceId,
            chatId: context.chatId,
            path: filePath,
          })
          const buffer = await fetchWorkspaceFileBuffer(fileRecord)
          const base64 = buffer.toString('base64')
          const mime = fileRecord.type || 'image/png'
          parts.push({
            inlineData: { mimeType: mime, data: base64 },
          })
          logger.info('Loaded reference image', {
            filePath,
            name: fileRecord.name,
            size: buffer.length,
            mimeType: mime,
          })
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
        referenceImageCount: referencePaths.length,
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

      const resolvedOutputPath = outputFile.path
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      const mode = outputFile.mode

      assertServerToolNotAborted(context)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        userId: context.userId,
        target: {
          path: resolvedOutputPath,
          mode,
          mimeType: outputFile.mimeType,
        },
        buffer: imageBuffer,
        inferredMimeType: mimeType,
      })

      logger.info('Generated image saved', {
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        size: imageBuffer.length,
        mimeType,
      })

      return {
        success: true,
        message: `Image ${referencePaths.length ? 'edited' : 'generated'} and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${imageBuffer.length} bytes)`,
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        downloadUrl: written.downloadUrl,
        _serviceCost: { service: 'nano_banana_2', cost: NANO_BANANA_IMAGE_COST_USD },
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('Image generation failed', { error: msg })
      return { success: false, message: `Failed to generate image: ${msg}` }
    }
  },
}
