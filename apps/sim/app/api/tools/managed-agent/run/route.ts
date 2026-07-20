import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  MANAGED_AGENT_BYOK_PROVIDER,
  runManagedAgentContract,
} from '@/lib/api/contracts/managed-agents'
import { parseRequest } from '@/lib/api/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runManagedAgentSession } from '@/lib/managed-agents/run-session'

export const dynamic = 'force-dynamic'
/** Sessions can run for several minutes; bound generously above the run loop's own caps. */
export const maxDuration = 800

const logger = createLogger('ManagedAgentRunAPI')

/**
 * Internal route that runs one Managed Agent session. Executor-only
 * (server-to-server internal auth) — the browser never invokes it. The
 * workspace Claude Platform key is resolved server-side from the workflow's
 * workspace and never leaves the server.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(runManagedAgentContract, request, {})
  if (!parsed.success) return parsed.response
  const { body, query } = parsed.data

  const workflowId = query.workflowId
  if (!workflowId) {
    return NextResponse.json(
      { success: false, error: 'Missing workflowId — is this tool running inside a workflow?' },
      { status: 400 }
    )
  }

  const [row] = await db
    .select({ workspaceId: workflow.workspaceId, name: workflow.name })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  const workspaceId = row?.workspaceId
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: 'Workflow is not associated with a workspace.' },
      { status: 400 }
    )
  }

  // Vault authorization ack — enforced here because the block's condition
  // engine cannot test array-non-empty. Fails closed: attaching a vault
  // requires explicit confirmation, since the session assumes its identity.
  if (body.vaults && body.vaults.length > 0 && !body.vaultsAck) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Vault authorization is required — check the "I am authorized to use these vaults" acknowledgement on the block, or remove the selected vault(s).',
      },
      { status: 400 }
    )
  }

  const byok = await getBYOKKey(workspaceId, MANAGED_AGENT_BYOK_PROVIDER)
  if (!byok) {
    return NextResponse.json(
      {
        success: false,
        error:
          'No Claude Platform API key is configured for this workspace. Add one under Settings → API Keys (Claude Platform).',
      },
      { status: 400 }
    )
  }

  const result = await runManagedAgentSession({
    apiKey: byok.apiKey,
    agentId: body.agent,
    environmentId: body.environment,
    userMessage: body.userMessage,
    title: row?.name ? `Sim - ${row.name}` : undefined,
    vaultIds: body.vaults,
    memoryStoreId: body.memoryStoreId,
    memoryAccess: body.memoryAccess,
    fileIds: body.fileIds,
    sessionParameters: body.sessionParameters,
    signal: request.signal,
  })

  if (!result.ok) {
    logger.warn('Managed agent session failed', {
      workspaceId,
      workflowId,
      sessionId: result.sessionId,
      error: result.error,
    })
    return NextResponse.json(
      { success: false, error: result.error ?? 'Managed Agent session failed' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    success: true,
    output: { content: result.content, sessionId: result.sessionId ?? '' },
  })
})
