import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { generateFalVideo } from '@/lib/media/falai-video'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/mothership/application/execute-file-use-case'
import { GenerateVideo } from '@/lib/mothership/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'
import { assertOpaqueWorkspaceFileModelSafe } from '@/lib/mothership/tools/server/model-input'
import { writeCopilotWorkspaceFileByPath } from '@/lib/mothership/vfs/resource-writer'
import { createWorkspaceFileSecretProvenanceFromRegistry } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

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
      let imageDataUri: string | undefined
      const refPath = params.inputs?.files?.[0]?.path
      if (refPath) {
        const fileRecord = await resolveCopilotWorkspaceFileReference(
          context,
          fileOperations.readContent,
          {
            workspaceId,
            reference: refPath,
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

      const outputFile = params.outputs?.files?.[0]
      const outputPath = outputFile?.path || 'files/generated-video.mp4'
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      // The prompt is the only secret-bearing input; recording its provenance
      // keeps the written file model-readable (see generate-image).
      const promptProvenance = await createWorkspaceFileSecretProvenanceFromRegistry(
        context.resolvedSecretTraceRegistry,
        params.prompt,
        { userId: context.userId, workspaceId }
      )
      const written = await writeCopilotWorkspaceFileByPath(context, {
        workspaceId,
        target: { path: outputPath, mode, mimeType: outputFile?.mimeType },
        buffer: result.buffer,
        inferredMimeType: result.contentType,
        secretProvenance: promptProvenance.safe
          ? promptProvenance.provenance
          : { status: 'unknown' },
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
