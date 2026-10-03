/**
 * One Chat open in the desktop app and in a plain web tab at once. Both tail the same run, so a
 * desktop-only tool call (the agent browser, the terminal) reaches both. Runs against real
 * PostgreSQL and Redis: the web tab is the production stream tool-event path and client executor,
 * the desktop speaks its production protocol (claim through the authorize route, then report
 * through the confirm route), and the agent's answer is what the server-side waiter resolves.
 */
import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedEnv = { REDIS_URL: process.env.REDIS_URL }
  /** The real Redis module and the confirmation channel read this at import. */
  process.env.REDIS_URL = url
  return { redisUrl: url, inheritedEnv }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns, user, workspace } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import { executeBrowserToolOnClient } from '@/lib/mothership/tools/client/browser-tool-execution'
import { executeTerminalToolOnClient } from '@/lib/mothership/tools/client/terminal-tool-execution'
import { POST as confirmPOST } from '@/app/api/copilot/confirm/route'
import { POST as authorizePOST } from '@/app/api/desktop/tool/authorize/route'
import { dispatchStreamEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/dispatch-stream-event'
import { createStreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'

const APP_ORIGIN = 'http://localhost:3000'
const ROUTES: Record<string, (request: NextRequest) => Promise<Response>> = {
  '/api/copilot/confirm': async (request) => confirmPOST(request, {}),
  '/api/desktop/tool/authorize': async (request) => authorizePOST(request, {}),
}

/** Every route request a client has started, so a test can wait for fire-and-forget reports. */
const inFlight: Promise<Response>[] = []

function callRoute(path: string, { method, headers, body }: RequestInit): Promise<Response> {
  const handler = ROUTES[path]
  if (!handler) throw new Error(`No route fixture for ${path}`)
  const response = handler(new NextRequest(new URL(path, APP_ORIGIN), { method, headers, body }))
  inFlight.push(response)
  return response
}

/** The desktop app's server protocol: claim the pending call, run it, report its result. */
async function desktopExecutes(toolCallId: string, result: Record<string, unknown>) {
  const authorization = await callRoute('/api/desktop/tool/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolCallId }),
  })
  if (!authorization.ok) return { authorized: authorization.status, confirmed: null }
  const confirmation = await callRoute('/api/copilot/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolCallId, status: 'success', message: 'Done', data: result }),
  })
  return { authorized: authorization.status, confirmed: confirmation.status }
}

/**
 * A plain web tab receiving the call frame on its live tail: the production stream handler with
 * the executors `useChat` wires into it.
 */
async function webTabReceives(
  chatId: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
) {
  const ctx = createStreamLoopContext(
    makeStreamLoopDeps({
      startClientBrowserTool: (id, name, toolArgs, eventTs) => {
        if (isCurrentBrowserToolName(name))
          executeBrowserToolOnClient(id, name, toolArgs, chatId, eventTs)
      },
      startClientTerminalTool: (id, _name, toolArgs, eventTs) =>
        executeTerminalToolOnClient(id, toolArgs, chatId, eventTs),
    })
  )
  const envelope: PersistedStreamEventEnvelope = {
    type: 'tool',
    v: 1,
    seq: 1,
    ts: new Date().toISOString(),
    stream: { streamId: generateId(), cursor: '1' },
    payload: {
      phase: 'call',
      executor: 'client',
      mode: 'async',
      toolCallId,
      toolName,
      arguments: args,
      status: 'executing',
    },
  }
  dispatchStreamEvent(ctx, envelope)
  // The client executors are fire-and-forget: let any report they start reach the server.
  await sleep(250)
  await Promise.allSettled(inFlight)
}

afterAll(async () => {
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  await closeRedisConnection()
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('a desktop tool call watched by a web tab', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()
  const runId = generateId()

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Desktop executor fixture',
      email: `${userId}@desktop-executor.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop executor fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: generateId(),
    })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'paused_waiting_for_tool',
      requestContext: { source: 'headless_lifecycle' },
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId, email: `${userId}@desktop-executor.test`, name: 'Desktop executor' },
      session: { id: generateId(), userId },
    })
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      callRoute(new URL(String(input), APP_ORIGIN).pathname, init ?? {})
    )
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it.each([
    ['browser_find', { query: 'Sign in' }],
    ['terminal', { operation: 'run', args: { command: 'ls' } }],
  ])(
    'delivers the desktop result of %s when the web tab receives the call first',
    async (toolName, args) => {
      const toolCallId = generateId()
      await db
        .insert(copilotAsyncToolCalls)
        .values({ runId, toolCallId, toolName, args, status: 'pending' })
      const agentAnswer = waitForClientToolCompletion({
        toolCallId,
        runId,
        userId,
        timeoutMs: 10_000,
      })

      await webTabReceives(chatId, toolCallId, toolName, args)
      const desktop = await desktopExecutes(toolCallId, { matches: 1 })
      expect(desktop).toEqual({ authorized: 200, confirmed: 200 })
      expect(await agentAnswer).toMatchObject({ status: 'success' })
      const [row] = await db
        .select({ status: copilotAsyncToolCalls.status })
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      expect(row.status).toBe('completed')
    }
  )
})
