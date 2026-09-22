import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  readFileWorkflow,
  readSharedFileWorkflowAsMember,
  runFileWorkflow,
  runSharedFileWorkflowAsMember,
} from '@/lib/workspace-files/application/file-workflows'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { updateWorkspaceFileMetadata } from '@/lib/workspace-files/application/update-workspace-file-metadata'
import {
  type FileWorkflowInputValues,
  type FileWorkflowSnapshot,
  fileWorkflowIdsSchema,
} from '@/lib/workspace-files/workflows/types'

interface FileWorkflowArgs {
  path: string
  action: 'configure' | 'run' | 'read'
  workflowIds?: string[]
  workflowId?: string
  input?: FileWorkflowInputValues
  audience?: 'private' | 'share'
}

interface FileWorkflowResult {
  success: boolean
  message: string
  data?: { workflowIds: string[] } | FileWorkflowSnapshot
}

export const fileWorkflowServerTool: BaseServerTool<FileWorkflowArgs, FileWorkflowResult> = {
  name: 'file_workflow',
  async execute(params, context?: ServerToolContext): Promise<FileWorkflowResult> {
    if (!context?.userId) throw new Error('Authentication required')
    if (!context.workspaceId) throw new OrchestrationError('validation', 'Workspace ID is required')
    const workspaceId = context.workspaceId
    try {
      if (params.action === 'configure') {
        if (
          params.workflowIds === undefined ||
          params.workflowId !== undefined ||
          params.input !== undefined ||
          params.audience !== undefined
        )
          throw new OrchestrationError('validation', 'configure requires workflowIds only')
        const workflowIds = fileWorkflowIdsSchema.parse(params.workflowIds)
        const file = await resolveCopilotWorkspaceFileReference(
          context,
          fileOperations.updateMetadata,
          { workspaceId, reference: params.path }
        )
        assertServerToolNotAborted(context)
        const data = await executeCopilotFileUseCase(
          context,
          updateWorkspaceFileMetadata,
          { fileId: file.id, assertedWorkspaceId: workspaceId, workflowIds },
          { fileId: file.id }
        )
        return { success: true, message: 'File workflows configured', data }
      }

      if (params.action !== 'run' && params.action !== 'read')
        throw new OrchestrationError('validation', 'Unknown file workflow action')
      if (!params.workflowId || params.workflowIds !== undefined)
        throw new OrchestrationError('validation', `${params.action} requires workflowId only`)
      if (params.audience !== undefined && !['private', 'share'].includes(params.audience))
        throw new OrchestrationError('validation', 'Unknown file workflow audience')
      const operation =
        params.action === 'run' ? fileOperations.runWorkflow : fileOperations.readWorkflowResult
      const file = await resolveCopilotWorkspaceFileReference(context, operation, {
        workspaceId,
        reference: params.path,
      })
      assertServerToolNotAborted(context)
      const input = {
        fileId: file.id,
        assertedWorkspaceId: workspaceId,
        workflowId: params.workflowId,
        input: params.input,
      }
      let data: FileWorkflowSnapshot
      if (params.audience === 'share') {
        data =
          params.action === 'run'
            ? await executeCopilotFileUseCase(context, runSharedFileWorkflowAsMember, input, {
                fileId: file.id,
              })
            : await executeCopilotFileUseCase(context, readSharedFileWorkflowAsMember, input, {
                fileId: file.id,
              })
      } else {
        data =
          params.action === 'run'
            ? await executeCopilotFileUseCase(context, runFileWorkflow, input, { fileId: file.id })
            : await executeCopilotFileUseCase(context, readFileWorkflow, input, { fileId: file.id })
      }
      return { success: true, message: 'File workflow result', data }
    } catch (error) {
      return { success: false, message: messageForCopilotFileError(error, 'File workflow failed') }
    }
  },
}
