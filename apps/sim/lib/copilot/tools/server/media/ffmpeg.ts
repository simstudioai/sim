import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Ffmpeg } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { resolveToolInputFile } from '@/lib/copilot/tools/server/files/resolve-input-file'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { type FfmpegOperation, type MediaFile, runFfmpegOperation } from '@/lib/media/ffmpeg'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('FfmpegTool')

const VALID_OPERATIONS: FfmpegOperation[] = [
  'overlay_audio',
  'mux',
  'mix_audio',
  'concat',
  'trim',
  'scale_pad',
  'overlay_image',
  'add_text',
  'fade',
  'extract_audio',
  'convert',
  'thumbnail',
  'probe',
]

interface FfmpegArgs {
  operation: FfmpegOperation
  inputs?: { files?: Array<{ path: string }> }
  text?: string
  position?: string
  start?: number
  end?: number
  width?: number
  height?: number
  aspectRatio?: string
  volume?: number
  musicVolume?: number
  loopToVideo?: boolean
  format?: string
  outputs?: {
    files?: Array<{ path: string; mode?: 'create' | 'overwrite'; mimeType?: string }>
  }
}

interface FfmpegResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  vfsPath?: string
  downloadUrl?: string
  probe?: unknown
}

export const ffmpegServerTool: BaseServerTool<FfmpegArgs, FfmpegResult> = {
  name: Ffmpeg.id,

  async execute(params: FfmpegArgs, context?: ServerToolContext): Promise<FfmpegResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }
    if (!VALID_OPERATIONS.includes(params.operation)) {
      return { success: false, message: `Invalid operation "${params.operation}".` }
    }

    const inputPaths = params.inputs?.files?.map((f) => f.path) ?? []
    if (inputPaths.length === 0) {
      return { success: false, message: 'At least one input file is required in inputs.files' }
    }

    try {
      const mediaFiles: MediaFile[] = []
      for (const filePath of inputPaths) {
        const fileRecord = await resolveToolInputFile({
          workspaceId,
          chatId: context.chatId,
          path: filePath,
        })
        if (!fileRecord) {
          return { success: false, message: `Input file not found: ${filePath}` }
        }
        const buffer = await fetchWorkspaceFileBuffer(fileRecord)
        mediaFiles.push({
          buffer,
          mimeType: fileRecord.type || 'application/octet-stream',
          name: fileRecord.name,
        })
      }

      assertServerToolNotAborted(context)
      const result = await runFfmpegOperation(params.operation, mediaFiles, {
        text: params.text,
        position: params.position,
        start: params.start,
        end: params.end,
        width: params.width,
        height: params.height,
        aspectRatio: params.aspectRatio,
        volume: params.volume,
        musicVolume: params.musicVolume,
        loopToVideo: params.loopToVideo,
        format: params.format,
      })

      // probe reports metadata only — no file written.
      if (params.operation === 'probe') {
        return {
          success: true,
          message: `Probed ${mediaFiles[0]?.name ?? inputPaths[0]}: ${JSON.stringify(result.probe)}`,
          probe: result.probe,
        }
      }

      if (!result.buffer || !result.ext) {
        return { success: false, message: `ffmpeg ${params.operation} produced no output` }
      }

      const outputFile = params.outputs?.files?.[0]
      // Omitted outputs.files keeps the pre-feature `files/` default. Chat-scoped
      // one-offs are opt-in via an explicit "outputs/<name>" path — mothership's
      // chat-scoped-outputs flag steers the agent to pass one (and resource-writer
      // redirects outputs/ to files/ for non-interactive runs, which lack a
      // persisted copilot_chats row).
      const outputPath = outputFile?.path || `files/ffmpeg-${params.operation}.${result.ext}`
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      const written = await writeWorkspaceFileByPath({
        workspaceId,
        userId: context.userId,
        chatId: context.chatId,
        interactive: context.interactive,
        messageId: context.messageId,
        target: { path: outputPath, mode, mimeType: outputFile?.mimeType },
        buffer: result.buffer,
        inferredMimeType: result.contentType || 'application/octet-stream',
      })

      logger.info('ffmpeg operation completed', {
        operation: params.operation,
        vfsPath: written.vfsPath,
        size: result.buffer.length,
      })

      return {
        success: true,
        message: `${params.operation} completed and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${result.buffer.length} bytes)`,
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        downloadUrl: written.downloadUrl,
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('ffmpeg operation failed', { operation: params.operation, error: msg })
      return { success: false, message: `ffmpeg ${params.operation} failed: ${msg}` }
    }
  },
}
