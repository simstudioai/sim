import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { GenerateAudio } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getSingleMediaFileDeclaration,
  prepareMediaOutput,
  resolveMediaInputFile,
} from '@/lib/copilot/tools/server/media/file-paths'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { type AudioType, generateFalAudio } from '@/lib/media/falai-audio'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('GenerateAudioTool')

const VALID_TYPES: AudioType[] = ['speech', 'music', 'sfx']

interface GenerateAudioArgs {
  prompt: string
  type?: string
  model?: string
  voice?: string
  duration?: number
  /** For music: explicit lyrics for a vocal track. */
  lyrics?: string
  /** For music: true = instrumental (default), false = vocal track. */
  instrumental?: boolean
  /** Optional reference voice sample (workspace audio file) for zero-shot voice cloning. */
  inputs?: { files?: Array<{ path: string }> }
  outputs?: {
    files?: Array<{ path: string; mode?: 'create' | 'overwrite'; mimeType?: string }>
  }
}

interface GenerateAudioResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  vfsPath?: string
  downloadUrl?: string
  _serviceCost?: { service: string; cost: number }
}

export const generateAudioServerTool: BaseServerTool<GenerateAudioArgs, GenerateAudioResult> = {
  name: GenerateAudio.id,

  async execute(
    params: GenerateAudioArgs,
    context?: ServerToolContext
  ): Promise<GenerateAudioResult> {
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

    const type = (params.type || 'speech') as AudioType
    if (!VALID_TYPES.includes(type)) {
      return {
        success: false,
        message: `Invalid type "${params.type}". Must be one of: ${VALID_TYPES.join(', ')}`,
      }
    }

    try {
      const outputFile = await prepareMediaOutput({
        output: params.outputs,
        workspaceId,
        userId: context.userId,
      })

      // Voice cloning: a reference sample clones that voice into the generated speech.
      let voiceSampleDataUri: string | undefined
      const inputFile = params.inputs
        ? getSingleMediaFileDeclaration(params.inputs.files, 'Input')
        : undefined
      if (inputFile) {
        const sample = await resolveMediaInputFile({
          workspaceId,
          chatId: context.chatId,
          path: inputFile.path,
        })
        const sampleBuffer = await fetchWorkspaceFileBuffer(sample)
        const sampleMime = sample.type || 'audio/mpeg'
        voiceSampleDataUri = `data:${sampleMime};base64,${sampleBuffer.toString('base64')}`
      }

      logger.info('Generating audio', {
        type,
        model: params.model,
        promptLength: params.prompt.length,
        voiceClone: Boolean(voiceSampleDataUri),
      })

      const result = await generateFalAudio({
        prompt: params.prompt,
        type,
        model: params.model,
        voice: params.voice,
        duration: params.duration,
        lyrics: params.lyrics,
        instrumental: params.instrumental,
        voiceSampleDataUri,
      })

      const outputPath = outputFile.path
      const mode = outputFile.mode

      assertServerToolNotAborted(context)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        userId: context.userId,
        target: { path: outputPath, mode, mimeType: outputFile.mimeType },
        buffer: result.buffer,
        inferredMimeType: result.contentType,
      })

      logger.info('Generated audio saved', {
        fileId: written.id,
        vfsPath: written.vfsPath,
        size: result.buffer.length,
        type,
        model: result.model,
      })

      return {
        success: true,
        message: `${type === 'speech' ? 'Speech' : type === 'music' ? 'Music' : 'Sound effect'} generated and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${result.buffer.length} bytes, model ${result.model})`,
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        downloadUrl: written.downloadUrl,
        _serviceCost: { service: 'falai_audio', cost: result.cost.costDollars },
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('Audio generation failed', { error: msg })
      return { success: false, message: `Failed to generate audio: ${msg}` }
    }
  },
}
