import { createLogger } from '@sim/logger'
import type { LocalFilesystemExecutionContext } from '@/lib/mothership/tools/client/local-filesystem'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

const logger = createLogger('CopilotLocalFilesystemTool')

/**
 * Exactly-once guard. A call's chat view and the relay that runs it after the
 * user leaves can both see it, and a remounted view replays calls still
 * running, so the guard lives here rather than with any one caller.
 */
const launchedToolCallIds = new Set<string>()

/**
 * Runs a local filesystem tool call on the desktop client. The executor is
 * loaded on demand: it only runs for desktop-local calls, and a static import
 * kept it in the shared chat chunk on every surface that mounts the composer.
 * If the chunk fails to load (deploy skew), the server-side waiter must still
 * settle, so the failure is reported as an error completion instead of leaving
 * the call hanging.
 */
export function launchLocalFilesystemTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): void {
  if (
    !isNativeFileTool(toolName) &&
    (!context.workspaceId || !isUserLocalVfsToolCall(toolName, args))
  ) {
    return
  }
  if (launchedToolCallIds.has(toolCallId)) return
  launchedToolCallIds.add(toolCallId)

  import('@/lib/mothership/tools/client/local-filesystem').then(
    (m) => m.executeLocalFilesystemTool(toolCallId, toolName, args, context),
    async (error) => {
      logger.error('Failed to load local filesystem tool executor', { error })
      /**
       * The recovery itself can reject (the helper chunks or the completion POST can
       * fail for the same reason the executor chunk did). Contain it: an unhandled
       * rejection here would settle nothing and surface as a console error, exactly
       * like the executor's own report-failure path, which also degrades to a log.
       */
      try {
        const [{ reportClientToolCompletion }, { ASYNC_TOOL_CONFIRMATION_STATUS }] =
          await Promise.all([
            import('@/lib/mothership/tools/client/completion'),
            import('@/lib/mothership/async-runs/lifecycle'),
          ])
        await reportClientToolCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.error,
          'Local filesystem tool failed to load'
        )
      } catch (reportError) {
        logger.error('Failed to report local filesystem tool load failure', {
          toolCallId,
          error: reportError,
        })
      }
    }
  )
}
