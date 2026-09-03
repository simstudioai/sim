import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { GenerateImage } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { assertOpaqueWorkspaceFileModelSafe } from '@/lib/copilot/tools/server/model-input'
import { writeCopilotWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { createWorkspaceFileSecretProvenanceFromRegistry } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

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
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    if (!params.prompt) {
      return { success: false, message: 'prompt is required' }
    }

    try {
      const prompt = params.prompt
      const aspectRatio = params.aspectRatio || '1:1'
      const sizeHint = ASPECT_RATIO_TO_SIZE[aspectRatio]

      const parts: Part[] = []
      const referenceFiles = params.inputs?.files

      if (params.inputs !== undefined && !referenceFiles?.length) {
        throw new Error('inputs.files must contain at least one reference image when inputs is set')
      }

      for (const { path: filePath } of referenceFiles ?? []) {
        if (filePath.startsWith('uploads/')) {
          throw new Error(
            `Reference image "${filePath}" is still a chat upload. Run save_upload first, then use its canonical files/... path in generate_image inputs.files.`
          )
        }

        try {
          const fileRecord = await resolveCopilotWorkspaceFileReference(
            context,
            fileOperations.readContent,
            {
              workspaceId,
              reference: filePath,
            }
          )
          await assertOpaqueWorkspaceFileModelSafe({ workspaceId, file: fileRecord })
          const { content: buffer } = await executeCopilotFileUseCase(
            context,
            readWorkspaceFileContent,
            {
              fileId: fileRecord.id,
              assertedWorkspaceId: workspaceId,
              maxBytes: MAX_MEDIA_BYTES,
            },
            { fileId: fileRecord.id }
          )
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
        } catch (error) {
          throw new Error(
            `Failed to load reference image "${filePath}": ${getErrorMessage(error, 'Unknown error')}`
          )
        }
      }

      const loadedReferenceCount = parts.length

      const apiKey = getRotatingApiKey('gemini')
      const ai = new GoogleGenAI({ apiKey })

      const sizeInstruction = sizeHint
        ? ` Generate the image at ${sizeHint} resolution with a ${aspectRatio} aspect ratio.`
        : ''

      parts.push({ text: prompt + sizeInstruction })

      logger.info('Generating image with Nano Banana 2', {
        model: NANO_BANANA_MODEL,
        aspectRatio,
        promptLength: prompt.length,
        referenceImageCount: loadedReferenceCount,
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
      const outputPath = outputFile?.path || `files/generated-image${ext}`
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      // Reference images were asserted opaque-egress-safe above, so the prompt
      // is the only secret-bearing input this file can inherit. Recording its
      // provenance is what keeps the written file readable by the model later:
      // a write without a sidecar stamps the file "unknown" and every
      // content-view read of it is refused.
      const promptProvenance = await createWorkspaceFileSecretProvenanceFromRegistry(
        context.resolvedSecretTraceRegistry,
        prompt,
        { userId: context.userId, workspaceId }
      )
      const written = await writeCopilotWorkspaceFileByPath(context, {
        workspaceId,
        target: {
          path: outputPath,
          mode,
          mimeType: outputFile?.mimeType,
        },
        buffer: imageBuffer,
        inferredMimeType: mimeType,
        secretProvenance: promptProvenance.safe
          ? promptProvenance.provenance
          : { status: 'unknown' },
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
        message: `Image ${loadedReferenceCount ? 'edited' : 'generated'} and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${imageBuffer.length} bytes)`,
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
