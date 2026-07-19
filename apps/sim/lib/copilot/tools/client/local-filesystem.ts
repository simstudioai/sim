import type {
  LocalFilesystemData,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { requestJson } from '@/lib/api/client/request'
import { stageLocalFileUploadContract } from '@/lib/api/contracts/mothership-chats'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/copilot/async-runs/lifecycle'
import { reportClientToolCompletion } from '@/lib/copilot/tools/client/completion'
import { LOCAL_FILESYSTEM_TOOL_NAMES } from '@/lib/copilot/tools/local-filesystem'
import { getDesktopBridge } from '@/lib/desktop'
import { uploadViaApiFallback } from '@/lib/uploads/client/api-fallback'
import { DirectUploadError, runUploadStrategy } from '@/lib/uploads/client/direct-upload'

const logger = createLogger('CopilotLocalFilesystemTool')

interface LocalFilesystemExecutionContext {
  workspaceId: string
  chatId?: string
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

function bridge(): NonNullable<Window['simDesktop']> {
  const desktop = getDesktopBridge()
  if (!desktop?.localFilesystem) {
    throw new Error('The desktop local filesystem bridge is unavailable.')
  }
  return desktop
}

function requestForTool(toolName: string, args: Record<string, unknown>): LocalFilesystemRequest {
  switch (toolName) {
    case LOCAL_FILESYSTEM_TOOL_NAMES.mountDirectory:
      return { operation: 'mount_directory' }
    case LOCAL_FILESYSTEM_TOOL_NAMES.listMounts:
      return { operation: 'list_mounts' }
    case LOCAL_FILESYSTEM_TOOL_NAMES.forgetMount:
      return { operation: 'forget_mount', uri: requiredString(args, 'uri') }
    case LOCAL_FILESYSTEM_TOOL_NAMES.list:
      return { operation: 'list', uri: requiredString(args, 'uri') }
    case LOCAL_FILESYSTEM_TOOL_NAMES.glob:
      return {
        operation: 'glob',
        uri: requiredString(args, 'uri'),
        pattern: requiredString(args, 'pattern'),
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.read:
      return {
        operation: 'read',
        uri: requiredString(args, 'uri'),
        ...(typeof args.startLine === 'number' ? { startLine: args.startLine } : {}),
        ...(typeof args.lineCount === 'number' ? { lineCount: args.lineCount } : {}),
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.grep:
      return {
        operation: 'grep',
        uri: requiredString(args, 'uri'),
        query: requiredString(args, 'query'),
        ...(typeof args.include === 'string' ? { include: args.include } : {}),
        ...(typeof args.caseSensitive === 'boolean' ? { caseSensitive: args.caseSensitive } : {}),
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.stat:
      return { operation: 'stat', uri: requiredString(args, 'uri') }
    default:
      throw new Error(`Unsupported local filesystem tool: ${toolName}`)
  }
}

function successfulData(response: LocalFilesystemResponse): LocalFilesystemData {
  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.data
}

async function stageLocalFile(
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): Promise<Record<string, unknown>> {
  if (!context.chatId) {
    throw new Error('The chat is not ready to receive a local file yet.')
  }
  const uri = requiredString(args, 'uri')
  const data = successfulData(await bridge().localFilesystem({ operation: 'read_file_bytes', uri }))
  if (!('bytes' in data)) {
    throw new Error('The desktop app returned an invalid local file response.')
  }

  const bytes = data.bytes
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const file = new File([buffer], data.name)
  const presignedEndpoint = `/api/files/presigned?type=mothership&workspaceId=${encodeURIComponent(context.workspaceId)}`

  let uploaded: { key: string }
  try {
    uploaded = await runUploadStrategy({
      file,
      workspaceId: context.workspaceId,
      context: 'mothership',
      presignedEndpoint,
    })
  } catch (error) {
    if (!(error instanceof DirectUploadError) || error.code !== 'FALLBACK_REQUIRED') {
      throw error
    }
    const fallback = await uploadViaApiFallback(file, 'mothership', context.workspaceId)
    if (!fallback.key) {
      throw new Error('The local file upload did not return a storage key.')
    }
    uploaded = { key: fallback.key }
  }

  const staged = await requestJson(stageLocalFileUploadContract, {
    body: {
      workspaceId: context.workspaceId,
      chatId: context.chatId,
      key: uploaded.key,
    },
  })

  return {
    sourceUri: uri,
    uploadPath: staged.uploadPath,
    fileName: staged.fileName,
    displayName: staged.displayName,
    size: data.size,
    nextStep:
      'Call materialize_file with fileName before passing this file to server-side tools. Use the files/... path returned by materialize_file.',
  }
}

async function execute(
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): Promise<unknown> {
  if (toolName === LOCAL_FILESYSTEM_TOOL_NAMES.stageFile) {
    return stageLocalFile(args, context)
  }
  return successfulData(await bridge().localFilesystem(requestForTool(toolName, args)))
}

export function executeLocalFilesystemTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): void {
  void execute(toolName, args, context).then(
    async (data) => {
      try {
        await reportClientToolCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.success,
          'Local filesystem tool completed.',
          data
        )
      } catch (reportError) {
        logger.error('Failed to report local filesystem tool completion', {
          toolCallId,
          toolName,
          error: toError(reportError).message,
        })
      }
    },
    async (error) => {
      const message = toError(error).message
      logger.warn('Local filesystem tool failed', { toolCallId, toolName, error: message })
      try {
        await reportClientToolCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message,
          { error: message }
        )
      } catch (reportError) {
        logger.error('Failed to report local filesystem tool error', {
          toolCallId,
          toolName,
          error: toError(reportError).message,
        })
      }
    }
  )
}
