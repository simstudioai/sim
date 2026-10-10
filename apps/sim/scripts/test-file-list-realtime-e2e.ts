import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import { member, permissions, projectWorkspace, workspace as workspaceTable } from '@sim/db/schema'
import { insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { ROOM_ACCESS_REVOKED_EVENT } from '@sim/realtime-protocol/events'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { io, type Socket } from 'socket.io-client'

function required(value: unknown): string {
  assert.ok(typeof value === 'string' && value, 'Required local runtime value missing')
  return value
}
const base = new URL(required(process.env.FILE_LIST_REALTIME_BASE_URL))
const relay = new URL(required(process.env.FILE_LIST_REALTIME_RELAY_URL))
const database = new URL(required(process.env.DATABASE_URL))
for (const value of [base, relay, database])
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(value.hostname), 'Local runtime required')
assert.match(database.pathname, /test/i, 'Disposable database required')
const reportPath = required(process.env.FILE_LIST_REALTIME_REPORT_PATH)
const fixtureDir = required(process.env.FILE_LIST_REALTIME_FIXTURE_DIR)
const account = toRecord(JSON.parse(await readFile(join(fixtureDir, 'owner-account.json'), 'utf8')))
const ownerCookie = toArray(account.cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const sockets: Socket[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const statuses: { method: string; path: string; status: number }[] = []
const fixture = { workspaceId: '', projectId: '', secondEnvironmentId: '', readerId: '' }
let readerCookie = ''
const readerAccount = {
  email: `list-reader-${generateId()}@example.test`,
  password: `${generateId()}Aa9!`,
}
let ownerId = ''
let fileId = ''
let folderId = ''
let revision = ''
let reader: Socket
let owner: Socket
let workspaceObserver: Socket
const projectEvents: Record<string, unknown>[] = []
const workspaceEvents: Record<string, unknown>[] = []

async function saveReport() {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checks,
        statuses,
        fixture,
        fixtureMethod:
          'Existing real owner session and supported HTTP workspace/file writes; second environment and reader membership use isolated database fixtures; reader session uses real email signup.',
      },
      null,
      2
    )
  )
}
async function check(name: string, action: () => Promise<void>) {
  const start = performance.now()
  try {
    await action()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    throw error
  } finally {
    await saveReport()
  }
}
async function request(
  path: string,
  method = 'GET',
  body?: object,
  cookie = ownerCookie,
  extraHeaders?: Record<string, string>
) {
  // boundary-raw-fetch: standalone E2E exercises actual authenticated HTTP and the internal service boundary.
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: base.origin,
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(90_000),
  })
  statuses.push({ method, path: new URL(path, base).pathname, status: response.status })
  return { status: response.status, headers: response.headers, text: await response.text() }
}
function json(response: Awaited<ReturnType<typeof request>>, expected = 200) {
  assert.equal(response.status, expected, 'Unexpected HTTP status; inspect private app logs')
  return toRecord(JSON.parse(response.text))
}
async function waitEvent(
  socket: Socket,
  event: string,
  rejectEvent?: string,
  timeout = 15_000,
  action?: () => Promise<void>
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let startDeadline: () => void = () => undefined
  let accept: (value: unknown) => void
  let deny: (value: unknown) => void
  const cleanup = () => {
    clearTimeout(timer)
    socket.off(event, accept)
    if (rejectEvent) socket.off(rejectEvent, deny)
  }
  const signal = new Promise<Record<string, unknown>>((resolve, reject) => {
    function finish(error?: Error, value?: unknown) {
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(toRecord(value))
    }
    accept = (value: unknown) => finish(undefined, value)
    deny = (value: unknown) =>
      finish(new Error(`${event} rejected: ${String(toRecord(value).code ?? 'connection error')}`))
    socket.once(event, accept)
    if (rejectEvent) socket.once(rejectEvent, deny)
    /** The HTTP action has its own deadline; compilation time must not consume delivery time. */
    startDeadline = () => {
      if (!settled)
        timer = setTimeout(() => finish(new Error(`Timed out waiting for ${event}`)), timeout)
    }
  })
  /** Observe early rejection while the bounded HTTP action is still running. */
  void signal.catch(() => undefined)
  try {
    if (action) await action()
    startDeadline()
    return await signal
  } finally {
    cleanup()
  }
}
async function connect(cookie: string) {
  const token = required(
    json(await request('/api/auth/socket-token', 'POST', undefined, cookie)).token
  )
  const socket = io(relay.origin, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    auth: { token },
    extraHeaders: { Origin: base.origin },
  })
  sockets.push(socket)
  const connected = waitEvent(socket, 'connect', 'connect_error')
  socket.connect()
  await connected
  return socket
}
async function joinRoom(socket: Socket, type: 'project-files' | 'workspace-files', id: string) {
  const result = waitEvent(socket, `join-${type}-success`, `join-${type}-error`)
  socket.emit(`join-${type}`, { [type === 'project-files' ? 'projectId' : 'workspaceId']: id })
  return result
}
async function changed(action: () => Promise<void>) {
  const count = projectEvents.length
  const event = await waitEvent(reader, 'project-files-changed', undefined, 15_000, action)
  assert.deepEqual(Object.keys(event).sort(), ['projectId', 'timestamp'])
  assert.equal(event.projectId, fixture.projectId)
  assert.equal(typeof event.timestamp, 'number')
  assert.equal(projectEvents.length, count + 1, 'One committed operation must emit one signal')
}
async function unchanged(action: () => Promise<void>) {
  const count = projectEvents.length
  await action()
  await sleep(200)
  assert.equal(projectEvents.length, count, 'Rejected or staged work must not invalidate the list')
}
const prefix = () => `/api/projects/${fixture.projectId}/files`

try {
  await check('real sessions and canonical multi-environment Project fixture', async () => {
    ownerId = required(toRecord(json(await request('/api/auth/get-session')).user).id)
    const workspace = toRecord(
      json(
        await request('/api/workspaces', 'POST', {
          name: `Realtime list proof ${generateId()}`,
          skipDefaultWorkflow: true,
        })
      ).workspace
    )
    fixture.workspaceId = required(workspace.id)
    const [binding] = await db.select().from(workspace).where(eq(workspace.id, fixture.workspaceId))
    assert.ok(binding)
    fixture.projectId = binding.projectId
    const [canonicalWorkspace] = await db
      .select()
      .from(workspaceTable)
      .where(eq(workspaceTable.id, fixture.workspaceId))
    assert.ok(canonicalWorkspace)
    fixture.secondEnvironmentId = generateId()
    await insertWorkspaceFixture(db, {
      id: fixture.secondEnvironmentId,
      name: 'Hidden realtime environment',
      ownerId,
      billedAccountUserId: canonicalWorkspace.billedAccountUserId,
      organizationId: canonicalWorkspace.organizationId,
      workspaceMode: canonicalWorkspace.workspaceMode,
      forkedFromWorkspaceId: fixture.workspaceId,
    })
    const signup = await request(
      '/api/auth/sign-up/email',
      'POST',
      {
        ...readerAccount,
        name: 'List proof reader',
      },
      ''
    )
    fixture.readerId = required(toRecord(json(signup).user).id)
    readerCookie = signup.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
    assert.ok(readerCookie)
    await writeFile(
      join(fixtureDir, 'file-list-realtime-fixture.json'),
      JSON.stringify({ ...fixture, readerAccount, readerCookie }),
      { mode: 0o600 }
    )
    if (canonicalWorkspace.organizationId)
      await db.insert(member).values({
        id: generateId(),
        userId: fixture.readerId,
        organizationId: canonicalWorkspace.organizationId,
        role: 'member',
        createdAt: new Date(),
      })
    await db.insert(permissions).values({
      id: generateId(),
      userId: fixture.readerId,
      entityType: 'workspace',
      entityId: fixture.workspaceId,
      permissionType: 'read',
    })
    const files = json(await request(prefix(), 'GET', undefined, readerCookie))
    assert.equal(toRecord(files.capabilities).canRead, true)
    assert.equal(toRecord(files.capabilities).canWrite, false)
  })
  await check(
    'service callback rejects an ordinary session or missing socket subject',
    async () => {
      const path = `/api/internal/project-file-list/${fixture.projectId}/access`
      assert.equal((await request(path, 'POST')).status, 401)
      assert.equal(
        (
          await request(path, 'POST', undefined, '', {
            'x-api-key': required(process.env.INTERNAL_API_SECRET),
          })
        ).status,
        401
      )
    }
  )
  await check(
    'partial-access reader joins Project list while workspace wire remains unchanged',
    async () => {
      reader = await connect(readerCookie)
      owner = await connect(ownerCookie)
      workspaceObserver = await connect(ownerCookie)
      assert.deepEqual(await joinRoom(reader, 'project-files', fixture.projectId), {
        projectId: fixture.projectId,
      })
      assert.deepEqual(await joinRoom(owner, 'project-files', fixture.projectId), {
        projectId: fixture.projectId,
      })
      assert.deepEqual(await joinRoom(workspaceObserver, 'workspace-files', fixture.workspaceId), {
        workspaceId: fixture.workspaceId,
      })
      reader.on('project-files-changed', (event) => projectEvents.push(toRecord(event)))
      workspaceObserver.on('workspace-files-changed', (event) =>
        workspaceEvents.push(toRecord(event))
      )
    }
  )
  await check(
    'unknown Project and malformed room IDs cannot widen or evict current membership',
    async () => {
      const denied = waitEvent(owner, 'join-project-files-error', 'join-project-files-success')
      owner.emit('join-project-files', { projectId: generateId() })
      assert.equal((await denied).code, 'NOT_FOUND')
      const malformed = waitEvent(reader, 'join-project-files-error', 'join-project-files-success')
      reader.emit('join-project-files', { projectId: `${fixture.projectId}:other` })
      assert.equal((await malformed).code, 'INVALID_PAYLOAD')
      const whitespace = waitEvent(reader, 'join-project-files-error', 'join-project-files-success')
      reader.emit('join-project-files', { projectId: `${fixture.projectId} other` })
      assert.equal((await whitespace).code, 'INVALID_PAYLOAD')
    }
  )
  await check(
    'create broadcasts only after the canonical file is readable and never to the workspace room',
    async () => {
      const retainedMembership = await waitEvent(
        owner,
        'project-files-changed',
        undefined,
        15_000,
        () =>
          changed(async () => {
            const file = toRecord(
              json(
                await request(prefix(), 'POST', {
                  name: `live-${generateId()}.md`,
                  content: 'first version',
                  contentType: 'text/markdown',
                  encoding: 'utf-8',
                }),
                201
              ).file
            )
            fileId = required(file.id)
            revision = required(json(await request(`${prefix()}/${fileId}/versions`)).revision)
          })
      )
      assert.equal(
        toRecord(json(await request(`${prefix()}/${fileId}`, 'GET', undefined, readerCookie)).file)
          .id,
        fileId
      )
      assert.equal(retainedMembership.projectId, fixture.projectId)
      assert.equal(workspaceEvents.length, 0)
    }
  )
  await check('read-only mutation and stale revision do not broadcast', async () => {
    await changed(async () => {
      json(
        await request(`${prefix()}/${fileId}/content`, 'PUT', {
          content: 'advance before the stale-write check',
          encoding: 'utf-8',
          expectedRevision: revision,
        })
      )
    })
    await unchanged(async () => {
      assert.equal(
        (await request(`${prefix()}/${fileId}`, 'PATCH', { name: 'denied.md' }, readerCookie))
          .status,
        403
      )
      assert.equal(
        (
          await request(`${prefix()}/${fileId}/content`, 'PUT', {
            content: 'must not commit',
            encoding: 'utf-8',
            expectedRevision: revision,
          })
        ).status,
        409
      )
    })
  })
  await check(
    'rename, folder creation, move, content save, archive and restore each notify current viewers',
    async () => {
      await changed(async () => {
        json(await request(`${prefix()}/${fileId}`, 'PATCH', { name: 'renamed-live.md' }))
      })
      await changed(async () => {
        folderId = required(
          toRecord(
            json(await request(`${prefix()}/folders`, 'POST', { name: 'Live folder' })).folder
          ).id
        )
      })
      await changed(async () => {
        json(
          await request(`${prefix()}/move`, 'POST', {
            fileIds: [fileId],
            folderIds: [],
            targetFolderId: folderId,
          })
        )
      })
      revision = required(json(await request(`${prefix()}/${fileId}/versions`)).revision)
      await changed(async () => {
        json(
          await request(`${prefix()}/${fileId}/content`, 'PUT', {
            content: 'second version',
            encoding: 'utf-8',
            expectedRevision: revision,
          })
        )
      })
      await changed(async () => {
        json(await request(`${prefix()}/archive`, 'POST', { fileIds: [fileId], folderIds: [] }))
      })
      await changed(async () => {
        json(await request(`${prefix()}/${fileId}/restore`, 'POST', {}))
      })
    }
  )
  await check('copy emits only to the canonical destination owner', async () => {
    const workspaceFile = toRecord(
      json(
        await request(`/api/workspaces/${fixture.workspaceId}/files`, 'POST', {
          name: 'copy-source.txt',
          content: 'copy bytes',
          contentType: 'text/plain',
          encoding: 'utf-8',
        }),
        201
      ).file
    )
    await sleep(200)
    const before = workspaceEvents.length
    await changed(async () => {
      json(
        await request('/api/files/copy', 'POST', {
          source: {
            owner: { entityType: 'workspace', entityId: fixture.workspaceId },
            fileIds: [required(workspaceFile.id)],
            folderIds: [],
          },
          destination: {
            owner: { entityType: 'project', entityId: fixture.projectId },
            folderId: null,
          },
        }),
        201
      )
    })
    assert.equal(workspaceEvents.length, before)
  })
  await check(
    'upload allocation stays silent and only completed registration invalidates',
    async () => {
      let upload: Record<string, unknown> = {}
      const bytes = new TextEncoder().encode('streamed fixture bytes')
      await unchanged(async () => {
        upload = json(
          await request(`${prefix()}/uploads`, 'POST', {
            name: 'streamed.txt',
            contentType: 'text/plain',
            size: bytes.length,
          }),
          201
        )
      })
      const transfer = toRecord(upload.transfer)
      assert.equal(transfer.method, 'put')
      const target = new URL(required(transfer.url), base)
      assert.equal(target.origin, base.origin, 'Local storage transfer required')
      const headers = new Headers()
      for (const [key, value] of Object.entries(toRecord(transfer.headers)))
        headers.set(key, required(value))
      // boundary-raw-fetch: the real local provider receives binary bytes at its signed upload URL.
      const uploaded = await fetch(target, { method: 'PUT', headers, body: bytes })
      assert.ok(uploaded.ok)
      await changed(async () => {
        const result = json(
          await request(
            `${prefix()}/uploads/${required(toRecord(upload.session).id)}/complete`,
            'POST',
            {},
            ownerCookie,
            { 'upload-token': required(upload.uploadToken) }
          )
        )
        assert.equal(result.status, 'completed')
        assert.equal(toRecord(result.result).name, 'streamed.txt')
      })
    }
  )
  await check(
    'same live socket loses Project collection access after reader membership revocation',
    async () => {
      const revoked = waitEvent(reader, ROOM_ACCESS_REVOKED_EVENT, undefined, 75_000)
      await db
        .delete(permissions)
        .where(
          and(
            eq(permissions.userId, fixture.readerId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, fixture.workspaceId)
          )
        )
      const event = await revoked
      assert.deepEqual(event.room, { type: 'project-files', id: fixture.projectId })
      const denied = await request(prefix(), 'GET', undefined, readerCookie)
      assert.ok([403, 404].includes(denied.status))
      await unchanged(async () => {
        json(await request(`${prefix()}/${fileId}`, 'PATCH', { name: 'after-revocation.md' }))
      })
      const join = waitEvent(reader, 'join-project-files-error', 'join-project-files-success')
      reader.emit('join-project-files', { projectId: fixture.projectId })
      assert.ok(['NOT_FOUND', 'ACCESS_DENIED'].includes(required((await join).code)))
    }
  )
} catch {
  process.exitCode = 1
} finally {
  for (const socket of sockets) socket.disconnect()
  await saveReport()
}

process.stdout.write(
  `${JSON.stringify({ reportPath, passed: checks.filter((check) => check.status === 'passed').length, failed: checks.filter((check) => check.status === 'failed').length })}\n`
)
process.exit(checks.length > 0 && checks.every((check) => check.status === 'passed') ? 0 : 1)
