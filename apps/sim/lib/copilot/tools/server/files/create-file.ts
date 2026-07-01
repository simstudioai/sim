import { createLogger } from '@sim/logger'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { isPlanAliasPath } from '@/lib/copilot/vfs/workflow-aliases'
import { inferContentType } from './workspace-file'

const logger = createLogger('CreateFileServerTool')
const CREATE_FILE_TOOL_ID = 'create_file'

interface CreateFileArgs {
  fileName: string
  contentType?: string
  outputs?: { files?: Array<{ path: string; mode?: 'create' | 'overwrite'; mimeType?: string }> }
  args?: Record<string, unknown>
}

interface CreateFileResult {
  success: boolean
  message: string
  data?: {
    id: string
    name: string
    contentType: string
    vfsPath: string
    backingVfsPath?: string
  }
}

export const createFileServerTool: BaseServerTool<CreateFileArgs, CreateFileResult> = {
  name: CREATE_FILE_TOOL_ID,
  async execute(params: CreateFileArgs, context?: ServerToolContext): Promise<CreateFileResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

    const nested = params.args
    const fileName = params.fileName || (nested?.fileName as string) || ''
    const explicitType = params.contentType || (nested?.contentType as string) || undefined
    const outputFile = params.outputs?.files?.[0]
    if (!outputFile?.path && !fileName) {
      return { success: false, message: 'create_file requires outputs.files[0].path or fileName' }
    }
    const outputPath =
      outputFile?.path ?? (fileName.startsWith('files/') ? fileName : `files/${fileName}`)
    if (outputPath.trim().replace(/^\/+/, '').startsWith('outputs/')) {
      return {
        success: false,
        message:
          'create_file cannot target outputs/. The outputs/ folder holds single-shot generated files (images, downloads, media) and is not editable. Create editable files under files/ instead.',
      }
    }
    if (isPlanAliasPath(outputPath)) {
      return {
        success: false,
        message:
          'create_file does not initialize plan aliases; changelog.md is created automatically per workflow.',
      }
    }
    const contentType = outputFile?.mimeType ?? inferContentType(outputPath, explicitType)
    const emptyBuffer = Buffer.from('', 'utf-8')

    assertServerToolNotAborted(context)
    const result = await writeWorkspaceFileByPath({
      workspaceId,
      userId: context.userId,
      target: {
        path: outputPath,
        mode: outputFile?.mode ?? 'create',
        mimeType: outputFile?.mimeType,
      },
      buffer: emptyBuffer,
      inferredMimeType: contentType,
    })

    logger.info('File created via create_file', {
      fileId: result.id,
      name: result.vfsPath,
      contentType,
      userId: context.userId,
    })

    return {
      success: true,
      message: `File "${result.vfsPath}" created successfully`,
      data: {
        id: result.id,
        name: result.name,
        contentType,
        vfsPath: result.vfsPath,
        backingVfsPath: result.backingVfsPath,
      },
    }
  },
}
