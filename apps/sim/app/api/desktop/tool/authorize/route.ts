import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeDesktopToolContract } from '@/lib/api/contracts/desktop-tool-authorization'
import { parseRequest } from '@/lib/api/server'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import {
  claimPendingAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
} from '@/lib/mothership/async-runs/repository'
import {
  authenticateCopilotRequestSessionOnly,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import { isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

/**
 * Electron calls this endpoint from the main process before every privileged
 * native model action. It returns only server-persisted canonical tool args;
 * Electron validates local-file requests against them and uses them directly
 * for browser and terminal tools.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return createUnauthorizedResponse()
  }

  const parsed = await parseRequest(authorizeDesktopToolContract, request, {})
  if (!parsed.success) return parsed.response

  const toolCall = await getAsyncToolCall(parsed.data.body.toolCallId)
  if (!toolCall || (toolCall.status !== 'pending' && toolCall.status !== 'running')) {
    return createNotFoundResponse('Pending client tool call not found')
  }
  const run = await getRunSegment(toolCall.runId)
  if (!run || run.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (run.status === 'complete' || run.status === 'error' || run.status === 'cancelled') {
    return createNotFoundResponse('Pending client tool call not found')
  }

  const args = isRecordLike(toolCall.args) ? (toolCall.args as Record<string, unknown>) : {}
  const isBrowserTool = isCurrentBrowserToolName(toolCall.toolName)
  const isTerminalTool = isTerminalToolName(toolCall.toolName)
  const isLocalFileTool =
    toolCall.toolName === 'read_local_file' || toolCall.toolName === 'import_local_files'
  const authorized =
    isBrowserTool ||
    isTerminalTool ||
    isLocalFileTool ||
    isUserLocalVfsToolCall(toolCall.toolName, args)
  if (!authorized) {
    return NextResponse.json(
      { error: 'Tool call is not authorized for desktop execution' },
      { status: 403 }
    )
  }

  if (toolCall.toolName === 'import_local_files') {
    if (typeof args.targetWorkspaceId !== 'string')
      return NextResponse.json({ error: 'A target workspace is required' }, { status: 400 })
    try {
      await resolveInvocationWorkspace(
        {
          userId,
          chatId: run.chatId,
          workspaceId: run.workspaceId ?? undefined,
          organizationId: run.organizationId ?? undefined,
        },
        args.targetWorkspaceId
      )
    } catch (error) {
      const projected = internalOrchestrationErrorPolicy.project(error)
      if (!projected) throw error
      return NextResponse.json(projected.body, { status: projected.status })
    }
    if (parsed.data.body.claim) {
      if (
        toolCall.status !== 'pending' ||
        !(await claimPendingAsyncToolCall(toolCall.toolCallId, DESKTOP_TOOL_CLAIM_OWNER.files))
      )
        return NextResponse.json(
          { error: 'This import was already started; inspect its result before retrying' },
          { status: 409 }
        )
    } else if (
      toolCall.status !== 'running' ||
      toolCall.claimedBy !== DESKTOP_TOOL_CLAIM_OWNER.files
    )
      return createNotFoundResponse('The import must be started before reading file bytes')
  }

  // Browser and terminal actions are one-shot side effects on the user's own
  // machine, so the pending call is claimed here, atomically, before crossing
  // the Electron boundary — a replayed renderer event must not run a command
  // or click a button twice.
  if (isBrowserTool || isTerminalTool) {
    if (toolCall.status !== 'pending') {
      return createNotFoundResponse('Pending client tool call not found')
    }
    const claimed = await claimPendingAsyncToolCall(
      toolCall.toolCallId,
      isBrowserTool ? DESKTOP_TOOL_CLAIM_OWNER.browser : DESKTOP_TOOL_CLAIM_OWNER.terminal
    )
    if (!claimed) {
      return createNotFoundResponse('Pending client tool call not found')
    }
  }

  return NextResponse.json({
    toolName: toolCall.toolName,
    args,
    chatId: run.chatId,
  })
})
