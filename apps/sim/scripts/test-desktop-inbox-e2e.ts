import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { makeSignature } from 'better-auth/crypto'
import Redis from 'ioredis'
import postgres from 'postgres'
import type { z } from 'zod'
import {
  type ClaimDesktopToolBody,
  type ClaimDesktopToolResponse,
  type CompleteDesktopToolBody,
  type CompleteDesktopToolResponse,
  claimDesktopToolResponseSchema,
  completeDesktopToolResponseSchema,
  type DesktopInboxItem,
  type DesktopInboxQuery,
  type DesktopInboxResponse,
  desktopInboxResponseSchema,
  type RegisterDesktopDeviceBody,
  type RegisterDesktopDeviceResponse,
  type RenewDesktopToolLeaseBody,
  type RenewDesktopToolLeaseResponse,
  registerDesktopDeviceResponseSchema,
  renewDesktopToolLeaseResponseSchema,
} from '@/lib/api/contracts/desktop-executor'

/**
 * Simulates a Sim desktop background executor against a running local app, a disposable local
 * PostgreSQL database and a local Redis. SQL seeds the chats, the device-bound runs and the
 * desktop calls those runs issue, standing in for the run loop; every device action crosses the
 * real HTTP boundary: registration, the SSE doorbell, the inbox pull, claim, lease renewal and
 * completion. No chat view is open at any point.
 *
 * Start the app with the executor flag on and Redis configured, for example:
 *   MSHIP_DESKTOP_BACKGROUND_EXECUTOR=true COPILOT_TOOL_PERMISSIONS_ENABLED=true \
 *     REDIS_URL=redis://127.0.0.1:6379 bun run dev
 * then run:
 *   DESKTOP_INBOX_E2E_BASE_URL=http://127.0.0.1:3000 \
 *   DESKTOP_INBOX_E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/sim_test \
 *   DESKTOP_INBOX_E2E_REDIS_URL=redis://127.0.0.1:6379 \
 *   DESKTOP_INBOX_E2E_AUTH_SECRET=<the app's BETTER_AUTH_SECRET> \
 *   DESKTOP_INBOX_E2E_REPORT_PATH=./desktop-inbox-e2e.json \
 *   bun --no-env-file scripts/test-desktop-inbox-e2e.ts
 */
const logger = createLogger('DesktopInboxE2E')
const PICKUP_GRACE_SECONDS = 15
const RECONCILE_MS = 2_000

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('DESKTOP_INBOX_E2E_BASE_URL'))
const databaseUrl = new URL(requiredEnvironment('DESKTOP_INBOX_E2E_DATABASE_URL'))
const redisUrl = new URL(requiredEnvironment('DESKTOP_INBOX_E2E_REDIS_URL'))
const authSecret = requiredEnvironment('DESKTOP_INBOX_E2E_AUTH_SECRET')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
assert(loopbackHosts.has(databaseUrl.hostname), 'The database must use a loopback host')
assert(/test/i.test(databaseUrl.pathname), 'Use a dedicated test database')
assert(loopbackHosts.has(redisUrl.hostname), 'Redis must use a loopback host')

const sql = postgres(databaseUrl.toString(), { max: 4 })
const redis = new Redis(redisUrl.toString(), { maxRetriesPerRequest: 2 })
const startedAt = new Date().toISOString()
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const http: { method: string; path: string; status: number; durationMs: number }[] = []
const userIds: string[] = []

interface Desktop {
  userId: string
  workspaceId: string
  sessionId: string
  cookie: string
  deviceId: string
}

async function request<S extends z.ZodType>(
  desktop: Desktop,
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; expected?: number; schema?: S } = {}
): Promise<z.output<S>> {
  const started = Date.now()
  // boundary-raw-fetch: drives the running app from another process as the desktop does, with the device's session cookie, and asserts the raw status of refusals; responses are still parsed with the contract schemas.
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Cookie: `better-auth.session_token=${desktop.cookie}`,
      Origin: baseUrl.origin,
      'User-Agent': 'Sim Desktop',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  http.push({
    method,
    path: path.split('?')[0],
    status: response.status,
    durationMs: Date.now() - started,
  })
  assert.equal(
    response.status,
    options.expected ?? 200,
    `${method} ${path}: ${response.status} ${text}`
  )
  const body: unknown = text ? JSON.parse(text) : undefined
  return options.schema ? options.schema.parse(body) : (body as z.output<S>)
}

async function check(name: string, run: () => Promise<void>) {
  const started = Date.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Date.now() - started })
    logger.info(`passed: ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Date.now() - started,
      error: getErrorMessage(error),
    })
    throw error
  }
}

/** A user signed in to Sim desktop: its own Better Auth session, as the desktop handoff creates. */
async function signIn(existing?: Desktop): Promise<Desktop> {
  const userId = existing?.userId ?? generateId()
  const workspaceId = existing?.workspaceId ?? generateId()
  const sessionId = generateId()
  const token = generateShortId()
  await sql.begin(async (tx) => {
    if (!existing) {
      userIds.push(userId)
      const email = `${userId}@desktop-inbox-e2e.test`
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${userId}, 'Desktop inbox E2E', ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
      await tx`insert into workspace (id, name, owner_id, billed_account_user_id)
        values (${workspaceId}, 'Desktop inbox E2E', ${userId}, ${userId})`
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
        values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
    }
    await tx`insert into session (id, token, user_id, user_agent, expires_at, created_at, updated_at)
      values (${sessionId}, ${token}, ${userId}, 'Sim Desktop', now() + interval '1 day', now(), now())`
  })
  const cookie = encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`)
  return { userId, workspaceId, sessionId, cookie, deviceId: generateId() }
}

async function register(desktop: Desktop): Promise<RegisterDesktopDeviceResponse> {
  const body: RegisterDesktopDeviceBody = {
    deviceId: desktop.deviceId,
    name: 'E2E MacBook',
    appVersion: '0.9.0',
    platform: 'darwin-arm64',
    capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
  }
  return request(desktop, 'POST', '/api/desktop/devices', {
    body,
    schema: registerDesktopDeviceResponseSchema,
  })
}

/** The device's reconciling pull, the same request on every doorbell and timer tick. */
async function pullInbox(desktop: Desktop): Promise<DesktopInboxResponse> {
  const query: DesktopInboxQuery = { deviceId: desktop.deviceId }
  return request(desktop, 'GET', `/api/desktop/inbox?${new URLSearchParams(query)}`, {
    schema: desktopInboxResponseSchema,
  })
}

/** A chat whose running turn was bound to the device at admission. */
async function boundChat(desktop: Desktop, title: string) {
  const chatId = generateId()
  const runId = generateId()
  const streamId = generateId()
  await sql`insert into copilot_chats (id, user_id, workspace_id, type, title, conversation_id)
    values (${chatId}, ${desktop.userId}, ${desktop.workspaceId}, 'mothership', ${title}, ${streamId})`
  await sql`insert into copilot_runs (id, execution_id, chat_id, user_id, workspace_id, stream_id,
      tool_execution_version, status, desktop_device_id)
    values (${runId}, ${generateId()}, ${chatId}, ${desktop.userId}, ${desktop.workspaceId}, ${streamId},
      2, 'paused_waiting_for_tool', ${desktop.deviceId})`
  return { chatId, runId, streamId }
}

/**
 * What the run loop does when the model calls a desktop tool on a bound run: persist the call
 * pending and offer it (or hold it for approval when `gated`) and, unless `silent`, ring the
 * device's doorbell.
 */
async function issueCall(
  desktop: Desktop,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { gated?: boolean; silent?: boolean } = {}
) {
  const toolCallId = generateId()
  await sql`insert into copilot_async_tool_calls (run_id, tool_call_id, tool_name, args, status,
      permission_requested_at, pickup_deadline_at)
    values (${runId}, ${toolCallId}, ${toolName}, ${JSON.stringify(args)}::jsonb, 'pending',
      ${options.gated ? sql`now()` : null},
      ${options.gated ? null : sql`now() + ${PICKUP_GRACE_SECONDS} * interval '1 second'`})`
  if (!options.silent)
    await redis.publish(
      'desktop:inbox',
      JSON.stringify({ deviceId: desktop.deviceId, reason: options.gated ? 'approval' : 'call' })
    )
  return toolCallId
}

/** Reads the device's SSE doorbell over a real streaming response. */
function openDoorbell(desktop: Desktop) {
  const controller = new AbortController()
  const events: string[] = []
  const listeners = new Set<() => void>()
  // boundary-raw-fetch: reads the SSE doorbell as a stream.
  const opened = fetch(new URL(`/api/desktop/inbox/stream?deviceId=${desktop.deviceId}`, baseUrl), {
    headers: { Cookie: `better-auth.session_token=${desktop.cookie}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  }).then(async (response) => {
    http.push({
      method: 'GET',
      path: '/api/desktop/inbox/stream',
      status: response.status,
      durationMs: 0,
    })
    assert.equal(response.status, 200, `inbox stream: ${response.status}`)
    assert(response.body, 'inbox stream has no body')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    void (async () => {
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buffer += value
          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const event = /^event: (.+)$/m.exec(frame)?.[1]
            const data = /^data: (.+)$/m.exec(frame)?.[1]
            if (event) {
              const reason = data ? JSON.parse(data).reason : undefined
              events.push(reason ? `${event}:${reason}` : event)
              for (const listener of listeners) listener()
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
      } catch {}
    })()
  })
  return {
    opened,
    events,
    onEvent(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => controller.abort(),
  }
}

/**
 * The simulated executor: pulls its inbox on every doorbell and on a reconcile timer, claims each
 * call in inbox order, renews its lease once, and posts a result. Returns what it ran, per call.
 */
function startExecutor(desktop: Desktop, doorbell: ReturnType<typeof openDoorbell>) {
  const ran = new Map<string, { toolName: string; chatId: string; executionToken: string }>()
  const completed = new Set<string>()
  let running = false
  let rerun = false
  let stopped = false
  const pull = async () => {
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      do {
        rerun = false
        const inbox = await pullInbox(desktop)
        for (const item of inbox.items) {
          if (item.kind !== 'call' || ran.has(item.toolCallId)) continue
          const claimBody: ClaimDesktopToolBody = {
            deviceId: desktop.deviceId,
            toolCallId: item.toolCallId,
          }
          const claim: ClaimDesktopToolResponse = await request(
            desktop,
            'POST',
            '/api/desktop/tool/claim',
            {
              body: claimBody,
              schema: claimDesktopToolResponseSchema,
            }
          )
          ran.set(item.toolCallId, {
            toolName: claim.toolName,
            chatId: claim.chatId,
            executionToken: claim.executionToken,
          })
          const renewBody: RenewDesktopToolLeaseBody = {
            deviceId: desktop.deviceId,
            toolCallId: item.toolCallId,
            executionToken: claim.executionToken,
          }
          const renewed: RenewDesktopToolLeaseResponse = await request(
            desktop,
            'POST',
            '/api/desktop/tool/lease',
            { body: renewBody, schema: renewDesktopToolLeaseResponseSchema }
          )
          assert.equal(renewed.renewed, true)
          const completeBody: CompleteDesktopToolBody = {
            deviceId: desktop.deviceId,
            toolCallId: item.toolCallId,
            executionToken: claim.executionToken,
            status: 'success',
            message: `${claim.toolName} done`,
            data: { ran: claim.toolName, chatId: claim.chatId },
          }
          const completedCall: CompleteDesktopToolResponse = await request(
            desktop,
            'POST',
            '/api/desktop/tool/complete',
            {
              body: completeBody,
              schema: completeDesktopToolResponseSchema,
            }
          )
          assert.deepEqual(completedCall, { outcome: 'recorded', status: 'completed' })
          completed.add(item.toolCallId)
        }
      } while (rerun && !stopped)
    } finally {
      running = false
    }
  }
  const offDoorbell = doorbell.onEvent(
    () => void pull().catch((error) => logger.error('pull failed', error))
  )
  const timer = setInterval(
    () => void pull().catch((error) => logger.error('reconcile failed', error)),
    RECONCILE_MS
  )
  void pull()
  return {
    ran,
    completed,
    stop() {
      stopped = true
      offDoorbell()
      clearInterval(timer)
    },
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string
) {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    assert(Date.now() < deadline, `Timed out waiting for ${label}`)
    await sleep(100)
  }
}

async function callRows(toolCallIds: string[]) {
  return sql<
    {
      tool_call_id: string
      status: string
      settled: boolean
      sealed: boolean
      claimed_by: string | null
    }[]
  >`select tool_call_id, status, execution_settled_at is not null as settled,
      result ? '__sealedClientToolCompletionV1' as sealed, claimed_by
    from copilot_async_tool_calls where tool_call_id = any(${toolCallIds})`
}

async function run() {
  const desktop = await signIn()

  await check('registers the desktop and receives the executor timing contract', async () => {
    const registration = await register(desktop)
    assert.equal(
      registration.enabled,
      true,
      'Start the app with MSHIP_DESKTOP_BACKGROUND_EXECUTOR=true'
    )
    assert(registration.leaseRenewMs < registration.leaseMs)
    assert(registration.reconcileMs < PICKUP_GRACE_SECONDS * 1000)
  })

  /** `next dev` compiles a route on its first request, which must not count against the timed checks. */
  await check('refuses malformed claim, lease and completion bodies', async () => {
    for (const path of [
      '/api/desktop/tool/claim',
      '/api/desktop/tool/lease',
      '/api/desktop/tool/complete',
    ]) {
      await request(desktop, 'POST', path, { body: {}, expected: 400 })
    }
  })

  /** Starts absent, so only the stream open below can mark the device present. */
  await redis.del(`desktop:presence:${desktop.deviceId}`)
  const doorbell = openDoorbell(desktop)
  await check('counts the device online once it opens its doorbell stream', async () => {
    await doorbell.opened
    await waitFor(
      async () => (await redis.exists(`desktop:presence:${desktop.deviceId}`)) === 1,
      10_000,
      'presence'
    )
  })

  const executor = startExecutor(desktop, doorbell)
  try {
    await check(
      'runs desktop calls from two chats nobody is viewing, and posts every result',
      async () => {
        const fixCi = await boundChat(desktop, 'Fix CI')
        const research = await boundChat(desktop, 'Research pricing')
        const issued = [
          await issueCall(desktop, fixCi.runId, 'terminal', {
            operation: 'read',
            terminalId: 't1',
          }),
          await issueCall(desktop, research.runId, 'browser_navigate', {
            url: 'https://example.com',
          }),
          await issueCall(desktop, fixCi.runId, 'read_local_file', { path: '/tmp/ci.log' }),
          await issueCall(desktop, research.runId, 'browser_snapshot', {}),
        ]
        await waitFor(
          () => issued.every((id) => executor.completed.has(id)),
          10_000,
          'all four calls'
        )
        assert.deepEqual(
          issued.map((id) => executor.ran.get(id)?.chatId),
          [fixCi.chatId, research.chatId, fixCi.chatId, research.chatId]
        )
        const rows = await callRows(issued)
        assert.equal(rows.length, 4)
        for (const row of rows) {
          assert.equal(row.status, 'completed', row.tool_call_id)
          assert.equal(row.settled, true, row.tool_call_id)
          assert.equal(row.sealed, true, row.tool_call_id)
          assert.equal(row.claimed_by, null, row.tool_call_id)
        }
      }
    )

    await check('reconciles a call whose doorbell was lost within its pickup window', async () => {
      const chat = await boundChat(desktop, 'Quiet chat')
      const issuedAt = Date.now()
      const toolCallId = await issueCall(
        desktop,
        chat.runId,
        'browser_click',
        { ref: 'e3' },
        { silent: true }
      )
      await waitFor(
        () => executor.ran.has(toolCallId),
        PICKUP_GRACE_SECONDS * 1000,
        'the reconcile pull to claim the call'
      )
      assert(Date.now() - issuedAt < PICKUP_GRACE_SECONDS * 1000)
      await waitFor(
        () => executor.completed.has(toolCallId),
        10_000,
        'the claimed call to complete'
      )
      const [row] = await callRows([toolCallId])
      assert.equal(row.status, 'completed')
    })

    await check('answers a retried result as a duplicate without changing it', async () => {
      const [[toolCallId, ran]] = [...executor.ran.entries()]
      const body: CompleteDesktopToolBody = {
        deviceId: desktop.deviceId,
        toolCallId,
        executionToken: ran.executionToken,
        status: 'error',
        message: 'a retry with another payload',
      }
      const retried = await request(desktop, 'POST', '/api/desktop/tool/complete', {
        body,
        schema: completeDesktopToolResponseSchema,
      })
      assert.deepEqual(retried, { outcome: 'duplicate', status: 'completed' })
    })

    await check('lists a gated command for approval and refuses to hand it over', async () => {
      const chat = await boundChat(desktop, 'Deploy')
      const toolCallId = await issueCall(
        desktop,
        chat.runId,
        'terminal',
        { operation: 'run', args: { command: 'npm run deploy' } },
        { gated: true }
      )
      const inbox = await pullInbox(desktop)
      const expected: DesktopInboxItem = {
        kind: 'approval_needed',
        toolCallId,
        toolName: 'terminal',
        chatId: chat.chatId,
        chatTitle: 'Deploy',
        workspaceId: desktop.workspaceId,
        summary: 'npm run deploy',
      }
      assert.deepEqual(
        inbox.items.find((item) => item.toolCallId === toolCallId),
        expected
      )
      await request(desktop, 'POST', '/api/desktop/tool/claim', {
        body: { deviceId: desktop.deviceId, toolCallId },
        expected: 403,
      })
    })
  } finally {
    executor.stop()
  }

  await check('tells the device to cancel a call whose chat was stopped', async () => {
    const chat = await boundChat(desktop, 'Long task')
    const toolCallId = await issueCall(
      desktop,
      chat.runId,
      'browser_wait_for',
      { text: 'Done' },
      { silent: true }
    )
    const claim = await request(desktop, 'POST', '/api/desktop/tool/claim', {
      body: { deviceId: desktop.deviceId, toolCallId },
      schema: claimDesktopToolResponseSchema,
    })
    /** What Stop commits in one transaction: admission closes and the open desktop call is settled. */
    await sql.begin(async (tx) => {
      await tx`update copilot_runs set tool_admission_closed_at = now() where id = ${chat.runId}`
      await tx`update copilot_async_tool_calls set status = 'cancelled', claimed_by = null,
        completed_at = now(), updated_at = now() where tool_call_id = ${toolCallId}`
    })
    const heardBefore = doorbell.events.length
    await redis.publish(
      'desktop:inbox',
      JSON.stringify({ deviceId: desktop.deviceId, reason: 'cancel' })
    )
    await waitFor(
      () => doorbell.events.slice(heardBefore).includes('inbox_changed:cancel'),
      5_000,
      'the cancel doorbell'
    )
    const lease: RenewDesktopToolLeaseBody = {
      deviceId: desktop.deviceId,
      toolCallId,
      executionToken: claim.executionToken,
    }
    await request(desktop, 'POST', '/api/desktop/tool/lease', { body: lease, expected: 410 })
    const inbox = await pullInbox(desktop)
    assert(inbox.items.some((item) => item.kind === 'cancel' && item.toolCallId === toolCallId))
    await request(desktop, 'POST', '/api/desktop/tool/complete', {
      body: { ...lease, status: 'cancelled' } satisfies CompleteDesktopToolBody,
      schema: completeDesktopToolResponseSchema,
    })
    const after = await pullInbox(desktop)
    assert(!after.items.some((item) => item.toolCallId === toolCallId))
  })

  await check("keeps another desktop's inbox empty and refuses its claims", async () => {
    const otherMac = await signIn(desktop)
    const registration = await register(otherMac)
    assert.equal(registration.enabled, true)
    const chat = await boundChat(desktop, 'Only on the first Mac')
    const toolCallId = await issueCall(
      desktop,
      chat.runId,
      'browser_click',
      { ref: 'e9' },
      { silent: true }
    )
    const inbox = await pullInbox(otherMac)
    assert.deepEqual(inbox.items, [])
    await request(otherMac, 'POST', '/api/desktop/tool/claim', {
      body: { deviceId: otherMac.deviceId, toolCallId },
      expected: 404,
    })
    await request(otherMac, 'POST', '/api/desktop/tool/claim', {
      body: { deviceId: desktop.deviceId, toolCallId },
      expected: 401,
    })
  })

  await check('disconnects the device when its session signs out', async () => {
    await sql`delete from session where id = ${desktop.sessionId}`
    await request(desktop, 'GET', `/api/desktop/inbox?deviceId=${desktop.deviceId}`, {
      expected: 401,
    })
  })

  doorbell.close()
  await check('leaves presence to its TTL when the doorbell stream closes', async () => {
    const key = `desktop:presence:${desktop.deviceId}`
    assert.equal(await redis.exists(key), 1)
    const ttl = await redis.ttl(key)
    assert(ttl > 0 && ttl <= 45, `presence TTL ${ttl}`)
  })
}

async function cleanup() {
  if (userIds.length === 0) return
  await sql`delete from copilot_chats where user_id = any(${userIds})`
  await sql`delete from desktop_devices where user_id = any(${userIds})`
  await sql`delete from workspace where owner_id = any(${userIds})`
  await sql`delete from "user" where id = any(${userIds})`
}

try {
  await run()
} catch (error) {
  logger.error('Desktop inbox E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
  } catch (error) {
    logger.error('Desktop inbox E2E fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
  await sql.end()
  redis.disconnect()
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: process.exitCode ? 'failed' : 'passed',
    transport:
      'Real HTTP and SSE against a local Next.js app, PostgreSQL and Redis; SQL stands in for the run loop',
    checks,
    http,
  }
  if (process.env.DESKTOP_INBOX_E2E_REPORT_PATH) {
    await writeFile(
      process.env.DESKTOP_INBOX_E2E_REPORT_PATH,
      `${JSON.stringify(report, null, 2)}\n`
    )
  }
  logger.info(
    `Desktop inbox E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${http.length} HTTP requests`
  )
  process.exit()
}
