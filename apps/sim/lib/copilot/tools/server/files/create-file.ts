import { createLogger } from '@sim/logger'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getWorkspaceFileByName,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { inferContentType, validateFlatWorkspaceFileName } from './workspace-file'

const logger = createLogger('CreateFileServerTool')
const CREATE_FILE_TOOL_ID = 'create_file'

interface CreateFileArgs {
  fileName: string
  contentType?: string
  args?: Record<string, unknown>
}

interface CreateFileResult {
  success: boolean
  message: string
  data?: {
    id: string
    name: string
    contentType: string
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

    const nameError = validateFlatWorkspaceFileName(fileName)
    if (nameError) return { success: false, message: nameError }

    const existingFile = await getWorkspaceFileByName(workspaceId, fileName)
    if (existingFile) {
      return { success: false, message: `File "${fileName}" already exists` }
    }

    const contentType = inferContentType(fileName, explicitType)
    const emptyBuffer = Buffer.from('', 'utf-8')

    assertServerToolNotAborted(context)
    const result = await uploadWorkspaceFile(
      workspaceId,
      context.userId,
      emptyBuffer,
      fileName,
      contentType
    )

    logger.info('File created via create_file', {
      fileId: result.id,
      name: fileName,
      contentType,
      userId: context.userId,
    })

    return {
      success: true,
      message: `File "${fileName}" created successfully`,
      data: {
        id: result.id,
        name: result.name,
        contentType,
      },
    }
  },
}
