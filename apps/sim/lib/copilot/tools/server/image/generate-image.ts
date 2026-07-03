import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GenerateImage } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { resolveToolInputFile } from '@/lib/copilot/tools/server/files/resolve-input-file'
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
      const apiKey = getRotatingApiKey('gemini')
      const ai = new GoogleGenAI({ apiKey })

      const aspectRatio = params.aspectRatio || '1:1'
      const sizeHint = ASPECT_RATIO_TO_SIZE[aspectRatio]

      const parts: Part[] = []

      const referencePaths = params.inputs?.files?.map((file) => file.path) ?? []

      if (referencePaths.length) {
        for (const filePath of referencePaths) {
          // An explicitly-passed reference the tool can't load must FAIL the
          // call, not silently generate from the prompt alone — the agent can
          // correct the path; a plausible-but-unrelated image just ships.
          let fileRecord: Awaited<ReturnType<typeof resolveToolInputFile>>
          let buffer: Buffer
          try {
            fileRecord = await resolveToolInputFile({
              workspaceId,
              chatId: context.chatId,
              path: filePath,
            })
            if (!fileRecord) {
              return {
                success: false,
                message: withMessageId(
                  `Reference file not found: "${filePath}". Check the path (files/, uploads/, or outputs/) and try again.`
                ),
              }
            }
            buffer = await fetchWorkspaceFileBuffer(fileRecord)
          } catch (err) {
            return {
              success: false,
              message: withMessageId(
                `Failed to load reference image "${filePath}": ${toError(err).message}`
              ),
            }
          }
          const mime = fileRecord.type || 'image/png'
          parts.push({
            inlineData: { mimeType: mime, data: buffer.toString('base64') },
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

      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png'
      const outputFile = params.outputs?.files?.[0]
      // Omitted outputs.files keeps the pre-feature `files/` default. Chat-scoped
      // one-offs are opt-in via an explicit "outputs/<name>" path — mothership's
      // chat-scoped-outputs flag steers the agent to pass one (and resource-writer
      // redirects outputs/ to files/ for non-interactive runs, which lack a
      // persisted copilot_chats row).
      const outputPath = outputFile?.path || `files/generated-image${ext}`
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        userId: context.userId,
        chatId: context.chatId,
        interactive: context.interactive,
        target: {
          path: outputPath,
          mode,
          mimeType: outputFile?.mimeType,
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
