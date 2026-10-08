import { isRecordLike, omit } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeDesktopToolContract } from '@/lib/api/contracts/desktop-tool-authorization'
import { parseRequest } from '@/lib/api/server'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import {
  claimDesktopToolCall,
  type DesktopToolCallClaim,
  getAsyncToolCall,
  getRunSegment,
} from '@/lib/mothership/async-runs/repository'
import {
  authenticateCopilotRequestSessionOnly,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import {
  chatViewDesktopLeaseOwnerToken,
  getDesktopToolClaimOwner,
  isDesktopToolCall,
  isLocalReadToolCall,
} from '@/lib/mothership/tools/desktop-tools'

const admissionClosedResponse = () =>
  NextResponse.json(
    { error: 'This chat turn ended or was stopped, so the tool call can no longer run' },
    { status: 410 }
  )

/** A refused claim answers the same way for every tool, except how each reports a lost race. */
function refusedClaimResponse(
  claim: Exclude<DesktopToolCallClaim['outcome'], 'claimed'>,
  notPending: () => NextResponse
): NextResponse {
  if (claim === 'closed') return admissionClosedResponse()
  if (claim === 'awaiting_permission')
    return NextResponse.json({ error: 'The user has not approved this tool call' }, { status: 403 })
  return notPending()
}

/**
 * Electron calls this endpoint from the main process before every privileged
 * native model action. It returns only server-persisted canonical tool args;
 * Electron validates local-file requests against them and uses them directly
 * for browser and terminal tools. The presentation-only `activity` field is
 * dropped: desktop actions reject arguments they do not declare.
 *
 * Nothing is handed over once the run's tool admission has closed (Stop, a
 * newer turn, or the run's end), nor for a call held for the user's decision
 * that they have not allowed.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return createUnauthorizedResponse()
  }

  const parsed = await parseRequest(authorizeDesktopToolContract, request, {})
  if (!parsed.success) return parsed.response

  const toolCall = await getAsyncToolCall(parsed.data.body.toolCallId)
  if (!toolCall) return createNotFoundResponse('Pending client tool call not found')
  const run = await getRunSegment(toolCall.runId)
  if (!run || run.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Ahead of the status checks: Stop settles the run's open calls in the same commit.
  if (run.toolAdmissionClosedAt) return admissionClosedResponse()
  if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
    return createNotFoundResponse('Pending client tool call not found')
  }
  if (run.status === 'complete' || run.status === 'error' || run.status === 'cancelled') {
    return createNotFoundResponse('Pending client tool call not found')
  }
  // The device's background executor claims a bound run's calls through its own fenced route.
  if (run.desktopDeviceId)
    return NextResponse.json(
      { error: "This chat's desktop actions run in the desktop app's background executor" },
      { status: 409 }
    )

  const args = isRecordLike(toolCall.args) ? (toolCall.args as Record<string, unknown>) : {}
  if (!isDesktopToolCall(toolCall.toolName, args)) {
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
      const alreadyStarted = () =>
        NextResponse.json(
          { error: 'This import was already started; inspect its result before retrying' },
          { status: 409 }
        )
      if (toolCall.status !== 'pending') return alreadyStarted()
      // An import runs as long as its files take, so its claim takes a lease this session holds:
      // the chat view renews it while the import runs. Reads finish in seconds and take none.
      const { outcome } = await claimDesktopToolCall({
        toolCallId: toolCall.toolCallId,
        runId: toolCall.runId,
        userId,
        claimedBy: DESKTOP_TOOL_CLAIM_OWNER.files,
        ...(principal
          ? { chatView: { ownerToken: chatViewDesktopLeaseOwnerToken(principal.sessionId) } }
          : {}),
      })
      if (outcome !== 'claimed') return refusedClaimResponse(outcome, alreadyStarted)
    } else if (
      toolCall.status !== 'running' ||
      toolCall.claimedBy !== DESKTOP_TOOL_CLAIM_OWNER.files
    )
      return createNotFoundResponse('The import must be started before reading file bytes')
  }

  // A desktop that claims local reads claims each one before its first read; its later reads of
  // the same call ride on that claim. A call persisted running (an older desktop's turn) is read
  // as before.
  if (parsed.data.body.claim && isLocalReadToolCall(toolCall.toolName, args)) {
    const notPending = () => createNotFoundResponse('Pending client tool call not found')
    if (toolCall.status === 'pending') {
      const { outcome } = await claimDesktopToolCall({
        toolCallId: toolCall.toolCallId,
        runId: toolCall.runId,
        userId,
        claimedBy: DESKTOP_TOOL_CLAIM_OWNER.files,
      })
      if (outcome !== 'claimed') return refusedClaimResponse(outcome, notPending)
    } else if (toolCall.claimedBy !== null && toolCall.claimedBy !== DESKTOP_TOOL_CLAIM_OWNER.files)
      return notPending()
  }

  // Browser and terminal actions are one-shot side effects on the user's own
  // machine, so the pending call is claimed here, atomically, before crossing
  // the Electron boundary — a replayed renderer event must not run a command
  // or click a button twice.
  const actionClaimOwner = getDesktopToolClaimOwner(toolCall.toolName)
  if (
    actionClaimOwner === DESKTOP_TOOL_CLAIM_OWNER.browser ||
    actionClaimOwner === DESKTOP_TOOL_CLAIM_OWNER.terminal
  ) {
    const notPending = () => createNotFoundResponse('Pending client tool call not found')
    if (toolCall.status !== 'pending') return notPending()
    const { outcome } = await claimDesktopToolCall({
      toolCallId: toolCall.toolCallId,
      runId: toolCall.runId,
      userId,
      claimedBy: actionClaimOwner,
    })
    if (outcome !== 'claimed') return refusedClaimResponse(outcome, notPending)
  }

  return NextResponse.json({
    toolName: toolCall.toolName,
    args: omit(args, ['activity']),
    chatId: run.chatId,
  })
})
