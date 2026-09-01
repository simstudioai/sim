import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  sshCheckCommandExistsContract,
  sshCheckFileExistsContract,
  sshCreateDirectoryContract,
  sshDeleteFileContract,
  sshDownloadFileContract,
  sshExecuteCommandContract,
  sshExecuteScriptContract,
  sshGetSystemInfoContract,
  sshListDirectoryContract,
  sshMoveRenameContract,
  sshReadFileContentContract,
  sshUploadFileContract,
  sshWriteFileContentContract,
} from '@/lib/api/contracts/storage-transfer'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { SshOperationError } from '@/lib/internal/ssh/errors'
import {
  executeSshCheckCommandExists,
  executeSshCheckFileExists,
  executeSshCreateDirectory,
  executeSshDeleteFile,
  executeSshDownloadFile,
  executeSshExecuteCommand,
  executeSshExecuteScript,
  executeSshGetSystemInfo,
  executeSshListDirectory,
  executeSshMoveRename,
  executeSshReadFileContent,
  executeSshUploadFile,
  executeSshWriteFileContent,
  type SshOperationContext,
} from '@/lib/internal/ssh/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('SshToolExecution')

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  operation: (input: ContractBody<C>, context: SshOperationContext) => Promise<unknown>,
  failureMessage: string
): Promise<Response> {
  request.signal?.throwIfAborted()
  if (!contract.body) throw new Error(`SSH contract ${contract.path} has no operation input`)
  const parsed = contract.body.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await operation(parsed.data as ContractBody<C>, { signal: request.signal })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof SshOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    if (isPayloadSizeLimitError(error)) {
      return Response.json({ error: error.message }, { status: 413 })
    }
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('SSH operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ error: `${failureMessage}: ${message}` }, { status: 500 })
  }
}

export const executeSshTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'ssh_check_command_exists':
      return executeOperation(
        sshCheckCommandExistsContract,
        request,
        executeSshCheckCommandExists,
        'SSH check command exists failed'
      )
    case 'ssh_check_file_exists':
      return executeOperation(
        sshCheckFileExistsContract,
        request,
        executeSshCheckFileExists,
        'SSH check file exists failed'
      )
    case 'ssh_create_directory':
      return executeOperation(
        sshCreateDirectoryContract,
        request,
        executeSshCreateDirectory,
        'SSH create directory failed'
      )
    case 'ssh_delete_file':
      return executeOperation(
        sshDeleteFileContract,
        request,
        executeSshDeleteFile,
        'SSH delete file failed'
      )
    case 'ssh_download_file':
      return executeOperation(
        sshDownloadFileContract,
        request,
        executeSshDownloadFile,
        'SSH file download failed'
      )
    case 'ssh_execute_command':
      return executeOperation(
        sshExecuteCommandContract,
        request,
        executeSshExecuteCommand,
        'SSH command execution failed'
      )
    case 'ssh_execute_script':
      return executeOperation(
        sshExecuteScriptContract,
        request,
        executeSshExecuteScript,
        'SSH script execution failed'
      )
    case 'ssh_get_system_info':
      return executeOperation(
        sshGetSystemInfoContract,
        request,
        executeSshGetSystemInfo,
        'SSH get system info failed'
      )
    case 'ssh_list_directory':
      return executeOperation(
        sshListDirectoryContract,
        request,
        executeSshListDirectory,
        'SSH list directory failed'
      )
    case 'ssh_move_rename':
      return executeOperation(
        sshMoveRenameContract,
        request,
        executeSshMoveRename,
        'SSH move/rename failed'
      )
    case 'ssh_read_file_content':
      return executeOperation(
        sshReadFileContentContract,
        request,
        executeSshReadFileContent,
        'SSH read file content failed'
      )
    case 'ssh_upload_file':
      return executeOperation(
        sshUploadFileContract,
        request,
        executeSshUploadFile,
        'SSH file upload failed'
      )
    case 'ssh_write_file_content':
      return executeOperation(
        sshWriteFileContentContract,
        request,
        executeSshWriteFileContent,
        'SSH write file content failed'
      )
    default:
      return Response.json({ error: `Unsupported SSH tool: ${request.toolId}` }, { status: 500 })
  }
}
