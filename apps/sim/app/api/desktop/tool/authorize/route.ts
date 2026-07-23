import { isBrowserToolName } from '@sim/browser-protocol'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeDesktopToolContract } from '@/lib/api/contracts/desktop-tool-authorization'
import { parseRequest } from '@/lib/api/server'
import {
  claimPendingAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
} from '@/lib/copilot/async-runs/repository'
import {
  authenticateCopilotRequestSessionOnly,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import {
  isUserLocalVfsToolCall,
  LOCAL_FILESYSTEM_TOOL_NAMES,
} from '@/lib/copilot/tools/local-filesystem'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const LEGACY_READ_ONLY_TOOLS = new Set<string>([
  LOCAL_FILESYSTEM_TOOL_NAMES.list,
  LOCAL_FILESYSTEM_TOOL_NAMES.glob,
  LOCAL_FILESYSTEM_TOOL_NAMES.read,
  LOCAL_FILESYSTEM_TOOL_NAMES.grep,
  LOCAL_FILESYSTEM_TOOL_NAMES.stat,
])

/**
 * Electron calls this endpoint from the main process before every privileged
 * native model action. It returns only server-persisted canonical tool args;
 * Electron validates local-file requests against them and uses them directly
 * for browser tools.
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

  const args =
    toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
      ? (toolCall.args as Record<string, unknown>)
      : {}
  const authorized =
    isBrowserToolName(toolCall.toolName) ||
    isUserLocalVfsToolCall(toolCall.toolName, args) ||
    LEGACY_READ_ONLY_TOOLS.has(toolCall.toolName)
  if (!authorized) {
    return NextResponse.json(
      { error: 'Tool call is not authorized for desktop execution' },
      { status: 403 }
    )
  }

  if (isBrowserToolName(toolCall.toolName)) {
    if (toolCall.status !== 'pending') {
      return createNotFoundResponse('Pending client tool call not found')
    }
    const claimed = await claimPendingAsyncToolCall(toolCall.toolCallId, 'desktop-browser')
    if (!claimed) {
      return createNotFoundResponse('Pending client tool call not found')
    }
  }

  return NextResponse.json({
    toolName: toolCall.toolName,
    args,
  })
})
