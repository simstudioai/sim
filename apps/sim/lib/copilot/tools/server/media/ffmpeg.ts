import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { Ffmpeg } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { writeCopilotWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { type FfmpegOperation, type MediaFile, runFfmpegOperation } from '@/lib/media/ffmpeg'
import { FFMPEG_LIMITS } from '@/lib/media/ffmpeg-limits'
import {
  createWorkspaceFileSecretProvenanceFromRegistry,
  getBoundWorkspaceFileSecretProvenance,
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('FfmpegTool')
const MEDIA_OPERATION_FAILED_SAFELY = 'The media operation failed safely'

/**
 * Backstops the `maxItems` the generated tool schema declares: the byte budget
 * below does not bound a call that lists many small clips, and a caller that
 * reaches this handler without passing Ajv still must not get an unbounded run.
 */
const { maxInputFiles: MAX_INPUT_FILES } = FFMPEG_LIMITS

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
      return {
        success: false,
        message: `Invalid operation "${params.operation}" (allowed: ${VALID_OPERATIONS.join(', ')}).`,
      }
    }

    const inputPaths = params.inputs?.files?.map((f) => f.path) ?? []
    if (inputPaths.length === 0) {
      return { success: false, message: 'At least one input file is required in inputs.files' }
    }
    if (inputPaths.length > MAX_INPUT_FILES) {
      return {
        success: false,
        message: `${inputPaths.length} input files were requested; at most ${MAX_INPUT_FILES} are allowed per ffmpeg call. Combine them in batches.`,
      }
    }

    let inputRequiresOpaqueError = false
    try {
      const mediaFiles: MediaFile[] = []
      let totalInputBytes = 0
      const inputProvenances: WorkspaceFileSecretProvenance[] = []
      for (const filePath of inputPaths) {
        // Preparing the inputs is itself the expensive part of a many-file call —
        // up to the whole byte budget in storage reads. Without this the run only
        // notices an explicit stop once every download has already finished.
        if (context.abortSignal?.aborted) {
          throw new Error('ffmpeg cancelled while preparing inputs')
        }
        const fileRecord = await resolveCopilotWorkspaceFileReference(
          context,
          fileOperations.readContent,
          {
            workspaceId,
            reference: filePath,
          }
        )
        // Reject on the recorded size before spending the download. The
        // accumulated check below still backstops a stale size row.
        if (totalInputBytes + fileRecord.size > MAX_MEDIA_BYTES) {
          throw new Error(`Input files exceed the ${MAX_MEDIA_BYTES} byte limit`)
        }
        const fileProvenance = await getBoundWorkspaceFileSecretProvenance(workspaceId, {
          fileId: fileRecord.id,
          key: fileRecord.key,
          context: fileRecord.storageContext ?? 'workspace',
        })
        inputRequiresOpaqueError ||=
          fileProvenance.status !== 'exact' || fileProvenance.entries.length > 0
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
        totalInputBytes += buffer.length
        if (totalInputBytes > MAX_MEDIA_BYTES) {
          throw new Error(`Input files exceed the ${MAX_MEDIA_BYTES} byte limit`)
        }
        inputProvenances.push(fileProvenance)
        mediaFiles.push({
          buffer,
          mimeType: fileRecord.type || 'application/octet-stream',
          name: fileRecord.name,
        })
      }

      const inputProvenance = mergeWorkspaceFileSecretProvenance(...inputProvenances)
      inputRequiresOpaqueError ||=
        inputProvenance.status !== 'exact' || inputProvenance.entries.length > 0
      assertServerToolNotAborted(context)
      const result = await runFfmpegOperation(
        params.operation,
        mediaFiles,
        {
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
        },
        // Every abort of this signal is an explicit user stop — the copilot
        // lifecycle tracks a passive client disconnect separately and does not
        // abort on it — so a transcode dies when the user says stop, and only then.
        { signal: context.abortSignal }
      )

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
      const outputPath = outputFile?.path || `files/ffmpeg-${params.operation}.${result.ext}`
      const mode = outputFile?.mode ?? 'create'
      let outputProvenance = inputProvenance
      if (params.operation === 'add_text' && params.text !== undefined) {
        const textProvenance = await createWorkspaceFileSecretProvenanceFromRegistry(
          context.resolvedSecretTraceRegistry,
          params.text,
          { userId: context.userId, workspaceId }
        )
        outputProvenance = mergeWorkspaceFileSecretProvenance(
          outputProvenance,
          textProvenance.safe ? textProvenance.provenance : { status: 'unknown' as const }
        )
      }

      assertServerToolNotAborted(context)
      const written = await writeCopilotWorkspaceFileByPath(context, {
        workspaceId,
        target: { path: outputPath, mode, mimeType: outputFile?.mimeType },
        buffer: result.buffer,
        inferredMimeType: result.contentType || 'application/octet-stream',
        secretProvenance: outputProvenance,
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
      const errorMessage = getErrorMessage(error, '')
      const projection = inputRequiresOpaqueError
        ? undefined
        : errorMessage
          ? projectResolvedSecretModelContent(errorMessage, context.resolvedSecretTraceRegistry)
          : undefined
      const message =
        projection?.safe && typeof projection.value === 'string' && projection.value.length > 0
          ? projection.value
          : MEDIA_OPERATION_FAILED_SAFELY
      logger.error('ffmpeg operation failed', { operation: params.operation, error: message })
      return { success: false, message: `ffmpeg ${params.operation} failed: ${message}` }
    }
  },
}
