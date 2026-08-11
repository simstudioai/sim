import { createLogger } from '@sim/logger'
import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { inferContentType } from '@/lib/copilot/tools/server/files/workspace-file'
import {
  createWorkspaceFileByPath,
  updateWorkspaceFileContentByPath,
} from '@/lib/workspace-files/application/write-workspace-file-by-path'

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
    const nested = params.args
    const fileName = params.fileName || (nested?.fileName as string) || ''
    const explicitType = params.contentType || (nested?.contentType as string) || undefined
    const outputFile = params.outputs?.files?.[0]
    if (!outputFile?.path && !fileName) {
      return { success: false, message: 'create_file requires outputs.files[0].path or fileName' }
    }
    const outputPath =
      outputFile?.path ?? (fileName.startsWith('files/') ? fileName : `files/${fileName}`)
    const contentType = outputFile?.mimeType ?? inferContentType(outputPath, explicitType)
    assertServerToolNotAborted(context)
    const mode = outputFile?.mode ?? 'create'
    try {
      const result =
        mode === 'overwrite'
          ? await executeCopilotFileUseCase(context, updateWorkspaceFileContentByPath, {
              workspaceId,
              path: outputPath,
              mode,
              content: '',
              encoding: 'utf-8',
              contentType,
              syncLiveDoc: false,
            })
          : await executeCopilotFileUseCase(context, createWorkspaceFileByPath, {
              workspaceId,
              path: outputPath,
              mode,
              content: '',
              encoding: 'utf-8',
              contentType,
              exactName: true,
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
        },
      }
    } catch (error) {
      return { success: false, message: messageForCopilotFileError(error, 'Failed to create file') }
    }
  },
}
