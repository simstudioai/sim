import type { LocalFilesystemMount } from '@sim/desktop-bridge'
import { runUserLocalFilesystemTool } from '@sim/desktop-bridge/local-filesystem-tools'
import { localFilesystemToolCompletion } from '@sim/desktop-bridge/tool-results'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getDesktopBridge } from '@/lib/desktop'
import { reportClientToolCompletion } from '@/lib/mothership/tools/client/completion'
import { executeNativeFileTool } from '@/lib/mothership/tools/client/native-files'
import { isNativeFileTool, USER_LOCAL_VFS_ROOT } from '@/lib/mothership/tools/local-filesystem'
import { encodeVfsSegment } from '@/lib/mothership/vfs/path-utils'

const logger = createLogger('CopilotLocalFilesystemTool')

interface LocalFilesystemExecutionContext {
  workspaceId?: string
  chatId?: string
  signal?: AbortSignal
}

function bridge(): NonNullable<Window['simDesktop']> {
  const desktop = getDesktopBridge()
  if (!desktop?.localFilesystem) {
    throw new Error('The desktop local filesystem bridge is unavailable.')
  }
  return desktop
}

function encodeMountName(name: string): string {
  try {
    return encodeVfsSegment(name)
  } catch {
    return encodeURIComponent(name)
  }
}

function mountVfsRoot(mount: LocalFilesystemMount): string {
  return `${USER_LOCAL_VFS_ROOT}/${encodeMountName(mount.name)}--${mount.id}`
}

async function reportCompletion(
  toolCallId: string,
  toolName: string,
  outcome: Parameters<typeof localFilesystemToolCompletion>[0]
): Promise<void> {
  const completion = localFilesystemToolCompletion(outcome)
  try {
    await reportClientToolCompletion(
      toolCallId,
      completion.status,
      completion.message,
      completion.data
    )
  } catch (reportError) {
    logger.error('Failed to report local filesystem tool result', {
      toolCallId,
      toolName,
      error: toError(reportError).message,
    })
  }
}

export async function executeLocalFilesystemTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): Promise<void> {
  if (isNativeFileTool(toolName)) {
    await executeNativeFileTool(toolCallId, toolName, context.signal)
    return
  }
  // Awaited to the end: the caller holds the turn's Stop lease until the tool has reported.
  await Promise.resolve()
    .then(() =>
      runUserLocalFilesystemTool(toolCallId, toolName, args, {
        invoke: (request) => bridge().localFilesystem(request),
        vfsRoot: mountVfsRoot,
        signal: context.signal,
      })
    )
    .then(
      async (data) => {
        if (context.signal?.aborted) return
        await reportCompletion(toolCallId, toolName, { ok: true, data })
      },
      async (error) => {
        if (context.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return
        }
        const message = toError(error).message
        logger.warn('Local filesystem tool failed', { toolCallId, toolName, error: message })
        await reportCompletion(toolCallId, toolName, { ok: false, error: message })
      }
    )
}
