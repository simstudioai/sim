import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { GenerateVideo } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  prepareMediaOutput,
  requireExactlyOneMediaFile,
  resolveMediaInputFile,
} from '@/lib/copilot/tools/server/media/file-paths'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { generateFalVideo } from '@/lib/media/falai-video'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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
      // Preflight explicit outputs so invalid paths fail before provider work begins.
      const outputFile = params.outputs?.files?.length
        ? await prepareMediaOutput({
            output: params.outputs,
            workspaceId,
            userId: context.userId,
          })
        : undefined

      let imageDataUri: string | undefined
      const inputFile = params.inputs
        ? requireExactlyOneMediaFile(params.inputs.files, 'Input')
        : undefined
      if (inputFile) {
        const fileRecord = await resolveMediaInputFile({
          workspaceId,
          chatId: context.chatId,
          path: inputFile.path,
        })
        const buffer = await fetchWorkspaceFileBuffer(fileRecord)
        const mime = fileRecord.type || 'image/png'
        imageDataUri = `data:${mime};base64,${buffer.toString('base64')}`
      }

      logger.info('Generating video', {
        model: params.model || 'veo-3.1-fast',
        promptLength: params.prompt.length,
        imageToVideo: Boolean(imageDataUri),
      })

      const result = await generateFalVideo({
        prompt: params.prompt,
        model: params.model,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.duration,
        generateAudio: params.generateAudio,
        negativePrompt: params.negativePrompt,
        promptOptimizer: params.promptOptimizer,
        imageDataUri,
      })

      const outputPath = outputFile?.path || 'files/generated-video.mp4'
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        userId: context.userId,
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
