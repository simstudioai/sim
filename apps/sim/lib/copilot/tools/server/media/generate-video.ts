import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { createCopilotFilePrincipal } from '@/lib/copilot/auth/file-delegation'
import { GenerateVideo } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  assertOpaqueWorkspaceFileModelSafe,
  projectServerToolModelInput,
} from '@/lib/copilot/tools/server/model-input'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { generateFalVideo } from '@/lib/media/falai-video'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

const logger = createLogger('GenerateVideoTool')

interface GenerateVideoArgs {
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  generateAudio?: boolean
  negativePrompt?: string
  promptOptimizer?: boolean
  inputs?: { files?: Array<{ path: string }> }
  outputs?: {
    files?: Array<{ path: string; mode?: 'create' | 'overwrite'; mimeType?: string }>
  }
}

interface GenerateVideoResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  vfsPath?: string
  downloadUrl?: string
  _serviceCost?: { service: string; cost: number }
}

export const generateVideoServerTool: BaseServerTool<GenerateVideoArgs, GenerateVideoResult> = {
  name: GenerateVideo.id,

  async execute(
    params: GenerateVideoArgs,
    context?: ServerToolContext
  ): Promise<GenerateVideoResult> {
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
      const modelInput = projectServerToolModelInput(
        { prompt: params.prompt, negativePrompt: params.negativePrompt },
        context
      )
      let imageDataUri: string | undefined
      const refPath = params.inputs?.files?.[0]?.path
      if (refPath) {
        const principal = createCopilotFilePrincipal(context, workspaceId)
        const fileRecord = await resolveWorkspaceFileReference({
          principal,
          operation: fileOperations.readContent,
          workspaceId,
          reference: refPath,
        })
        await assertOpaqueWorkspaceFileModelSafe({ workspaceId, file: fileRecord, context })
        const { content: buffer } = await readWorkspaceFileContent.execute({
          principal,
          input: {
            fileId: fileRecord.id,
            assertedWorkspaceId: workspaceId,
            maxBytes: MAX_MEDIA_BYTES,
          },
        })
        const mime = fileRecord.type || 'image/png'
        imageDataUri = `data:${mime};base64,${buffer.toString('base64')}`
      }

      logger.info('Generating video', {
        model: params.model || 'veo-3.1-fast',
        promptLength: params.prompt.length,
        imageToVideo: Boolean(imageDataUri),
      })

      const result = await generateFalVideo({
        prompt: modelInput.prompt,
        model: params.model,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.duration,
        generateAudio: params.generateAudio,
        negativePrompt: modelInput.negativePrompt,
        promptOptimizer: params.promptOptimizer,
        imageDataUri,
      })

      const outputFile = params.outputs?.files?.[0]
      const outputPath = outputFile?.path || 'files/generated-video.mp4'
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      const principal = createCopilotFilePrincipal(context, workspaceId)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        principal,
        target: { path: outputPath, mode, mimeType: outputFile?.mimeType },
        buffer: result.buffer,
        inferredMimeType: result.contentType,
      })

      logger.info('Generated video saved', {
        fileId: written.id,
        vfsPath: written.vfsPath,
        size: result.buffer.length,
        model: result.model,
      })

      return {
        success: true,
        message: `Video generated and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${result.buffer.length} bytes, model ${result.model})`,
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        downloadUrl: written.downloadUrl,
        _serviceCost: { service: 'falai_video', cost: result.cost.costDollars },
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('Video generation failed', { error: msg })
      return { success: false, message: `Failed to generate video: ${msg}` }
    }
  },
}
