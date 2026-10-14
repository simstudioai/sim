import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_SCHEMA_VERSION,
  type FileDocPresence,
  type JoinFileDocError,
  type JoinFileDocSuccess,
} from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import { randomInt } from '@sim/utils/random'
import { io, type Socket } from 'socket.io-client'
import { readWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'

/**
 * Real authenticated presence checks against two local realtime processes sharing Redis and one app.
 * Supply FILE_DOC_E2E_BASE_URL, FILE_DOC_E2E_REPLICA_A_URL, FILE_DOC_E2E_REPLICA_B_URL,
 * FILE_DOC_E2E_COOKIE (the full session Cookie header), FILE_DOC_E2E_WORKSPACE_ID,
 * FILE_DOC_E2E_FILE_ID (a writable Markdown fixture), and FILE_DOC_E2E_REPORT_PATH.
 * Run with `bun scripts/test-file-doc-presence-e2e.ts` from apps/sim. Keep other editors out of the
 * fixture during the run. The script uses the app's token mint and real socket authentication;
 * it changes only ephemeral room membership and leaves the fixture's content intact.
 */
const logger = createLogger('FileDocPresenceE2E')
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly supplied`)
  return value
}
function localUrl(name: string): URL {
  const url = new URL(required(name))
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${name} must be loopback`)
  assert.equal(url.protocol, 'http:')
  assert(!url.username && !url.password)
  return url
}
const base = localUrl('FILE_DOC_E2E_BASE_URL')
const replicas = [
  localUrl('FILE_DOC_E2E_REPLICA_A_URL'),
  localUrl('FILE_DOC_E2E_REPLICA_B_URL'),
] as const
assert.notEqual(replicas[0].origin, replicas[1].origin, 'Use distinct realtime process endpoints')
const cookie = required('FILE_DOC_E2E_COOKIE')
const workspaceId = required('FILE_DOC_E2E_WORKSPACE_ID')
const fileId = required('FILE_DOC_E2E_FILE_ID')
const reportPath = resolve(required('FILE_DOC_E2E_REPORT_PATH'))
const sockets: Socket[] = []
const rosters = new Map<Socket, FileDocPresence>()
const checks: { name: string; status: 'PASS' | 'FAIL'; durationMs: number; error?: string }[] = []
const providerA = randomInt(1, 0x7fff_ffff)
const providerB = providerA + 1

async function request(path: string, method = 'GET'): Promise<unknown> {
  // boundary-raw-fetch: standalone HTTP harness targets an explicit loopback app with a fixture cookie.
  const response = await fetch(new URL(path, base), {
    method,
    headers: { Cookie: cookie, Origin: base.origin },
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  })
  assert.equal(response.status, 200, `${method} ${path} failed`)
  return response.json()
}

async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'PASS', durationMs: performance.now() - start })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'FAIL',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    logger.error(`FAIL ${name}`)
    throw error
  }
}

async function waitForRoster(predicate: () => boolean) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    assert(Date.now() < deadline, 'Timed out waiting for the expected collaborator roster')
    await sleep(25)
  }
}

async function connect(endpoint: URL): Promise<Socket> {
  const { token } = toRecord(await request('/api/auth/socket-token', 'POST'))
  assert.equal(typeof token, 'string', 'The app must mint a real session token')
  assert.notEqual(token, 'anonymous-socket-token', 'Authentication must be enabled')
  const socket = io(endpoint.origin, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    autoConnect: false,
  })
  sockets.push(socket)
  socket.on(FILE_DOC_EVENTS.PRESENCE, (presence: FileDocPresence) => {
    if (presence.fileId === fileId) rosters.set(socket, presence)
  })
  await new Promise<void>((resolveConnection, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 15_000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolveConnection()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.connect()
  })
  return socket
}

async function join(socket: Socket, clientId: number) {
  await new Promise<void>((resolveJoin, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      socket.off(FILE_DOC_EVENTS.JOIN_SUCCESS, success)
      socket.off(FILE_DOC_EVENTS.JOIN_ERROR, failure)
    }
    const success = (result: JoinFileDocSuccess) => {
      if (result.fileId !== fileId || result.clientId !== clientId) return
      cleanup()
      resolveJoin()
    }
    const failure = (result: JoinFileDocError) => {
      cleanup()
      reject(new Error(result.code))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Document join timed out'))
    }, 15_000)
    socket.on(FILE_DOC_EVENTS.JOIN_SUCCESS, success)
    socket.on(FILE_DOC_EVENTS.JOIN_ERROR, failure)
    socket.emit(FILE_DOC_EVENTS.JOIN, { fileId, clientId, schemaVersion: FILE_DOC_SCHEMA_VERSION })
  })
}

function hasSessions(socket: Socket, expected: Socket[]): boolean {
  const users = rosters.get(socket)?.users
  return (
    users?.length === expected.length &&
    expected.every((peer) => users.some((user) => user.socketId === peer.id))
  )
}

try {
  await check('authenticated Markdown fixture is accessible', async () => {
    const file = readWorkspaceFileContract.response.schema.parse(
      await request(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}`
      )
    ).file
    assert.equal(file.type, 'text/markdown', 'Provide a dedicated Markdown fixture')
  })
  const a = await connect(replicas[0])
  let b = await connect(replicas[1])
  await check('both replicas publish both same-user sessions after join', async () => {
    await join(a, providerA)
    await join(b, providerB)
    await waitForRoster(() => hasSessions(a, [a, b]) && hasSessions(b, [a, b]))
    for (const socket of [a, b]) {
      assert.equal(new Set(rosters.get(socket)?.users.map((user) => user.userId)).size, 1)
    }
  })
  await check('leave refreshes the other replica without another join', async () => {
    b.emit(FILE_DOC_EVENTS.LEAVE, { fileId })
    await waitForRoster(() => hasSessions(a, [a]))
  })
  await check('rejoin restores both rosters', async () => {
    await join(b, providerB)
    await waitForRoster(() => hasSessions(a, [a, b]) && hasSessions(b, [a, b]))
  })
  await check('disconnect refreshes the other replica without another join', async () => {
    b.disconnect()
    await waitForRoster(() => hasSessions(a, [a]))
  })
  await check('reconnect with the same provider restores both rosters', async () => {
    b = await connect(replicas[1])
    await join(b, providerB)
    await waitForRoster(() => hasSessions(a, [a, b]) && hasSessions(b, [a, b]))
  })
} finally {
  for (const socket of sockets) socket.disconnect()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
}
