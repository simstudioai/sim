import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  type JoinFileDocError,
  type JoinFileDocPayload,
  type JoinFileDocSuccess,
} from '@sim/realtime-protocol/file-doc'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { startAccessRevalidationSweep } from '@/access-revalidation'
import { env } from '@/env'
import {
  cleanupFileDocForSocket,
  flushAllFileDocRooms,
  setupWorkspaceFileDocHandlers,
} from '@/handlers/file-doc'
import type { AuthenticatedSocket } from '@/middleware/auth'
import {
  beginRoomPermissionRead,
  commitRoomPermission,
  ROLE_REVALIDATION_TTL_MS,
} from '@/middleware/permissions'
import { MemoryRoomManager } from '@/rooms'
import { createHttpHandler } from '@/routes/http'

const projectId = generateId()
const fileId = generateId()
let docId = generateId()
const document = new Y.Doc()
document.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
document.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, docId)
let seed = Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64')
const clients: Socket[] = []
const actors = new Map<string, 'read' | 'write' | null>([
  ['reader', 'read'],
  ['writer', 'write'],
])
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
let app: HttpServer
let http: HttpServer
let io: Server
let socketUrl: string
const capturedActors: string[] = []
const seedFailures = new Map<string, number>()
const accessGates = new Map<
  string,
  {
    requests: number
    entered: ReturnType<typeof createDeferred<void>>
    release: ReturnType<typeof createDeferred<void>>
    status: number
  }
>()

async function listen(server: HttpServer) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return `http://127.0.0.1:${address.port}`
}

beforeAll(async () => {
  env.REDIS_URL = undefined
  app = createServer(async (request, response) => {
    const actor = request.headers['x-sim-subject-user-id']
    const connection = request.headers['x-sim-realtime-connection-id']
    response.setHeader('Content-Type', 'application/json')
    if (
      request.headers['x-api-key'] !== env.INTERNAL_API_SECRET ||
      typeof actor !== 'string' ||
      typeof connection !== 'string' ||
      !connection
    ) {
      response.writeHead(401).end('{}')
      return
    }
    if (!request.url?.startsWith(`/api/internal/project-file-doc/${projectId}/${fileId}/`)) {
      response.writeHead(404).end('{}')
      return
    }
    const gate = accessGates.get(actor)
    if (gate && request.url.endsWith('/access') && ++gate.requests > 1) {
      gate.entered.resolve()
      await gate.release.promise
      if (gate.status !== 200) {
        response.writeHead(gate.status).end('{}')
        return
      }
    }
    const role = actors.get(actor)
    if (!role) {
      response.writeHead(404).end('{}')
      return
    }
    if (request.url.endsWith('/access')) {
      response.end(
        JSON.stringify({ projectId, fileId, canRead: true, canWrite: role === 'write', docId })
      )
      return
    }
    if (request.url.endsWith('/seed')) {
      const failure = seedFailures.get(actor)
      if (failure) {
        response.writeHead(failure).end('{}')
        return
      }
      response.end(JSON.stringify({ update: seed, version: 1 }))
      return
    }
    if (request.url.endsWith('/persist')) {
      if (role !== 'write') {
        response.writeHead(403).end('{}')
        return
      }
      capturedActors.push(actor)
      response.end(JSON.stringify({ status: 'persisted', version: 2 }))
      return
    }
    response.writeHead(404).end('{}')
  })
  env.NEXT_PUBLIC_APP_URL = await listen(app)
  http = createServer()
  io = new Server(http)
  const manager = new MemoryRoomManager(io)
  http.on('request', createHttpHandler(manager, createLogger('OwnerProtocolFixture')))
  io.on('connection', (socket) => {
    const authed = socket as AuthenticatedSocket
    authed.userId = socket.handshake.auth.actor
    authed.userName = 'Fixture editor'
    authed.userImage = 'https://fixture.invalid/avatar.png'
    setupWorkspaceFileDocHandlers(authed, manager)
    socket.on('disconnect', () => cleanupFileDocForSocket(socket.id, io))
  })
  socketUrl = await listen(http)
})

async function startJoin(actor: string, assertedProject = projectId, owner?: unknown) {
  const socket = connect(socketUrl, { transports: ['websocket'], auth: { actor } })
  clients.push(socket)
  await new Promise<void>((resolve) => socket.once('connect', resolve))
  const joined = new Promise<JoinFileDocSuccess>((resolve, reject) => {
    socket.once(FILE_DOC_EVENTS.JOIN_SUCCESS, resolve)
    socket.once(FILE_DOC_EVENTS.JOIN_ERROR, (error) => reject(new Error(error.code)))
  })
  const client = new Y.Doc()
  const clientId = client.clientID
  client.destroy()
  socket.emit(FILE_DOC_EVENTS.JOIN, {
    fileId,
    ...(owner === undefined ? { projectId: assertedProject } : { owner }),
    clientId,
    schemaVersion: FILE_DOC_SCHEMA_VERSION,
  })
  return { socket, joined }
}

async function join(actor: string, assertedProject = projectId, owner?: unknown) {
  const pending = await startJoin(actor, assertedProject, owner)
  return { socket: pending.socket, joined: await pending.joined }
}

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const start = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - start })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - start,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

describe('Project documents across the Socket.IO and internal HTTP boundary', () => {
  for (const status of [404, 503]) {
    check(
      `a seed response of ${status} distinguishes a missing file from a failed join`,
      async () => {
        const actor = `seed-reader-${generateId()}`
        actors.set(actor, 'read')
        seedFailures.set(actor, status)
        const pending = await startJoin(actor)
        try {
          await expect(pending.joined).rejects.toThrow(status === 404 ? 'NOT_FOUND' : 'JOIN_FAILED')
          expect(
            io.sockets.sockets
              .get(pending.socket.id ?? '')
              ?.rooms.has(`project-file-doc:${projectId}/${fileId}`)
          ).toBe(false)
        } finally {
          seedFailures.delete(actor)
          pending.socket.disconnect()
        }
      }
    )
  }

  check('readers subscribe but cannot submit edits or become the persistence actor', async () => {
    const reader = await join('reader')
    expect(reader.joined.canWrite).toBe(false)
    const write = new Y.Doc()
    write.getText('body').insert(0, 'forged')
    const reply = await reader.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
      fileId,
      projectId,
      docId,
      updateId: generateId(),
      update: Y.encodeStateAsUpdate(write),
    })
    expect(reply).toMatchObject({ status: 'rejected', code: 'ACCESS_REVOKED' })
    expect(
      io.sockets.sockets
        .get(reader.socket.id ?? '')
        ?.rooms.has(`project-file-doc:${projectId}/${fileId}`)
    ).toBe(true)
    await flushAllFileDocRooms()
    expect(capturedActors).toEqual([])
    write.destroy()
  })

  for (const status of [200, 403, 503]) {
    check(`withholds Project broadcasts while final access resolves to ${status}`, async () => {
      const actor = `pending-${generateId()}`
      actors.set(actor, 'read')
      const gate = {
        requests: 0,
        entered: createDeferred<void>(),
        release: createDeferred<void>(),
        status,
      }
      accessGates.set(actor, gate)
      const writer = await join('writer')
      const installed = createDeferred<void>()
      const releaseAdapter = createDeferred<void>()
      const adapter = io.of('/').adapter
      const addAll = adapter.addAll.bind(adapter)
      adapter.addAll = async (id, rooms) => {
        await addAll(id, rooms)
        if (
          io.sockets.sockets.get(id)?.handshake.auth.actor === actor &&
          rooms.has(`project-file-doc:${projectId}/${fileId}`)
        ) {
          installed.resolve()
          await releaseAdapter.promise
        }
      }
      const pending = await startJoin(actor)
      const outcome = pending.joined.then(
        (value) => ({ value, error: null }),
        (error: Error) => ({ value: null, error })
      )
      const frames: string[] = []
      pending.socket.on(FILE_DOC_EVENTS.MESSAGE, () => frames.push('document'))
      pending.socket.on(FILE_DOC_EVENTS.PRESENCE, () => frames.push('presence'))
      try {
        await installed.promise
        const edit = new Y.Doc()
        Y.applyUpdate(edit, Buffer.from(seed, 'base64'))
        edit.getText('body').insert(0, `while-pending-${status}`)
        expect(
          await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            fileId,
            projectId,
            docId,
            updateId: generateId(),
            update: Y.encodeStateAsUpdate(edit),
          })
        ).toMatchObject({ status: 'accepted' })
        edit.destroy()
        await join('reader')
        const drained = new Promise<void>((resolve) =>
          pending.socket.once('fixture-drained', resolve)
        )
        io.sockets.sockets.get(pending.socket.id ?? '')?.emit('fixture-drained')
        await drained
        expect(frames).toEqual([])
        releaseAdapter.resolve()
        await gate.entered.promise
        await join('reader')
        const finalDrain = new Promise<void>((resolve) =>
          pending.socket.once('fixture-drained', resolve)
        )
        io.sockets.sockets.get(pending.socket.id ?? '')?.emit('fixture-drained')
        await finalDrain
        expect(frames).toEqual([])
      } finally {
        adapter.addAll = addAll
        releaseAdapter.resolve()
        gate.release.resolve()
      }
      const result = await outcome
      if (status === 200) expect(result.value?.canWrite).toBe(false)
      else {
        expect(result.error).not.toBeNull()
        expect(
          io.sockets.sockets
            .get(pending.socket.id ?? '')
            ?.rooms.has(`project-file-doc:${projectId}/${fileId}`)
        ).toBe(false)
        expect(frames).toEqual([])
      }
      accessGates.delete(actor)
      pending.socket.disconnect()
      writer.socket.disconnect()
    })
  }

  for (const rejectLeave of [false, true]) {
    check(
      `a stale rejoin preserves the admitted document when delayed cleanup ${rejectLeave ? 'rejects' : 'resolves'}`,
      async () => {
        const actor = `rejoining-${generateId()}`
        actors.set(actor, 'write')
        const admitted = await join(actor)
        const server = io.sockets.sockets.get(admitted.socket.id ?? '')
        if (!server) throw new Error('Admitted socket missing')
        const originalJoin = server.listeners(FILE_DOC_EVENTS.JOIN)[0]
        if (!originalJoin) throw new Error('Document join handler missing')
        const doc = new Y.Doc()
        const clientId = doc.clientID
        doc.destroy()
        const done = createDeferred<void>()
        const entered = createDeferred<void>()
        const release = createDeferred<void>()
        const observeJoin = async (payload: JoinFileDocPayload) => {
          try {
            await originalJoin.call(server, payload)
          } finally {
            if (payload.clientId === clientId) done.resolve()
          }
        }
        server.off(FILE_DOC_EVENTS.JOIN, originalJoin)
        server.on(FILE_DOC_EVENTS.JOIN, observeJoin)
        const adapter = io.of('/').adapter
        const del = adapter.del.bind(adapter)
        let held = false
        adapter.del = async (id, name) => {
          await del(id, name)
          if (
            !held &&
            id === server.id &&
            name === `project-file-doc:${projectId}/${fileId}:pending`
          ) {
            held = true
            entered.resolve()
            await release.promise
            if (rejectLeave) throw new Error('Fixture membership removal failed')
          }
        }
        try {
          admitted.socket.emit(FILE_DOC_EVENTS.JOIN, {
            fileId,
            projectId,
            clientId,
            schemaVersion: FILE_DOC_SCHEMA_VERSION,
          })
          await entered.promise
          const missingFileId = generateId()
          const rejected = new Promise<JoinFileDocError>((resolve) => {
            const onError = (error: JoinFileDocError) => {
              if (error.fileId !== missingFileId) return
              admitted.socket.off(FILE_DOC_EVENTS.JOIN_ERROR, onError)
              resolve(error)
            }
            admitted.socket.on(FILE_DOC_EVENTS.JOIN_ERROR, onError)
          })
          admitted.socket.emit(FILE_DOC_EVENTS.JOIN, {
            fileId: missingFileId,
            projectId,
            clientId: clientId + 1,
            schemaVersion: FILE_DOC_SCHEMA_VERSION,
          })
          expect((await rejected).code).toBe('NOT_FOUND')
          release.resolve()
          await done.promise
          const edit = new Y.Doc()
          Y.applyUpdate(edit, Buffer.from(seed, 'base64'))
          edit.getText('body').insert(0, 'preserved after failed navigation')
          const reply = await admitted.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            fileId,
            projectId,
            docId,
            updateId: generateId(),
            update: Y.encodeStateAsUpdate(edit),
          })
          edit.destroy()
          expect(reply).toMatchObject({ status: 'accepted' })
        } finally {
          release.resolve()
          adapter.del = del
          server.off(FILE_DOC_EVENTS.JOIN, observeJoin)
          server.on(FILE_DOC_EVENTS.JOIN, originalJoin)
          admitted.socket.disconnect()
        }
      }
    )
  }

  check(
    'a writer can publish and a reader joining later never replaces the actual editor',
    async () => {
      const writer = await join('writer')
      const edit = new Y.Doc()
      Y.applyUpdate(edit, Buffer.from(seed, 'base64'))
      edit.getText('body').insert(0, 'accepted')
      const reply = await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
        fileId,
        projectId,
        docId,
        updateId: generateId(),
        update: Y.encodeStateAsUpdate(edit),
      })
      expect(reply).toMatchObject({ status: 'accepted' })
      await join('reader')
      await flushAllFileDocRooms()
      expect(capturedActors.at(-1)).toBe('writer')
      edit.destroy()
    }
  )

  check(
    'owner-shaped clients share the existing room and preserve editor attribution',
    async () => {
      const owner = { entityType: 'project', entityId: projectId }
      const writer = await join('writer', projectId, owner)
      expect(writer.joined.docId).toBe(docId)
      const edit = new Y.Doc()
      Y.applyUpdate(edit, Buffer.from(seed, 'base64'))
      edit.getText('body').insert(0, 'owner-shaped edit')
      const reply = await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
        fileId,
        owner,
        docId,
        updateId: generateId(),
        update: Y.encodeStateAsUpdate(edit),
      })
      expect(reply).toMatchObject({ status: 'accepted' })
      await flushAllFileDocRooms()
      expect(capturedActors.at(-1)).toBe('writer')
      edit.destroy()
      await expect(join('reader', projectId, { ...owner, entityId: generateId() })).rejects.toThrow(
        'NOT_FOUND'
      )
      await expect(
        join('reader', projectId, { entityType: 'organization', entityId: projectId })
      ).rejects.toThrow('INVALID_PAYLOAD')
      const mismatched = await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
        fileId,
        owner,
        projectId: generateId(),
        docId,
        updateId: generateId(),
        update: Y.encodeStateAsUpdate(document),
      })
      expect(mismatched).toMatchObject({ status: 'rejected', code: 'INVALID_UPDATE' })
    }
  )

  check(
    'callback outages preserve membership and acknowledge writes as retryable; revocations still evict',
    async () => {
      const actor = `transient-${generateId()}`
      actors.set(actor, 'write')
      const writer = await join(actor)
      const gate = {
        requests: 1,
        entered: createDeferred<void>(),
        release: createDeferred<void>(),
        status: 503,
      }
      gate.release.resolve()
      accessGates.set(actor, gate)
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + ROLE_REVALIDATION_TTL_MS + 1)
      const sweep = startAccessRevalidationSweep(new MemoryRoomManager(io))
      sweep.stop()
      const room = `project-file-doc:${projectId}/${fileId}`
      try {
        await sweep.runOnce()
        expect(io.sockets.sockets.get(writer.socket.id ?? '')?.rooms.has(room)).toBe(true)
        const reply = await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
          fileId,
          projectId,
          docId,
          updateId: generateId(),
          update: Y.encodeStateAsUpdate(document),
        })
        expect(reply).toMatchObject({
          status: 'rejected',
          code: 'TEMPORARY_FAILURE',
          retryable: true,
        })
        gate.status = 404
        await sweep.runOnce()
        expect(io.sockets.sockets.get(writer.socket.id ?? '')?.rooms.has(room)).toBe(false)
      } finally {
        clock.mockRestore()
        accessGates.delete(actor)
        writer.socket.disconnect()
      }
    }
  )

  check('a downgraded writer remains a reader but cannot submit another update', async () => {
    const writer = await join('writer')
    actors.set('writer', 'read')
    commitRoomPermission(
      'writer',
      { type: 'project-file-doc', id: `${projectId}/${fileId}` },
      'read',
      beginRoomPermissionRead()
    )
    const reply = await writer.socket.timeout(1500).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
      fileId,
      projectId,
      docId,
      updateId: generateId(),
      update: Y.encodeStateAsUpdate(document),
    })
    expect(reply).toMatchObject({ status: 'rejected', code: 'ACCESS_REVOKED' })
    expect(
      io.sockets.sockets
        .get(writer.socket.id ?? '')
        ?.rooms.has(`project-file-doc:${projectId}/${fileId}`)
    ).toBe(true)
  })

  check('another Project cannot address the same file through a room hint', async () => {
    expect((await join('reader')).joined.canWrite).toBe(false)
    await expect(join('reader', generateId())).rejects.toThrow('NOT_FOUND')
  })
  check(
    'a restored canonical identity cannot join the prior live document before outbox delivery',
    async () => {
      const old = await join('reader')
      const replacement = new Y.Doc()
      docId = generateId()
      replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, docId)
      seed = Buffer.from(Y.encodeStateAsUpdate(replacement)).toString('base64')
      replacement.destroy()
      expect(old.joined.docId).not.toBe(docId)
      const restored = await join('reader')
      expect(restored.joined.docId).toBe(docId)
    }
  )

  check(
    'HTTP owner targeting fences the same generation and refuses unsupported or conflicting owners',
    async () => {
      const owner = { entityType: 'project', entityId: projectId }
      async function post(action: string, body: object) {
        return fetch(`${socketUrl}/api/file-doc/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
          body: JSON.stringify(body),
        })
      }
      for (const action of ['apply-edit', 'invalidate', 'retire']) {
        const body = {
          fileId,
          owner,
          markdown: '',
          version: 100,
          retiredDocId: docId,
          replacementDocId: generateId(),
        }
        expect((await post(action, { ...body, projectId: generateId() })).status).toBe(400)
        expect(
          (
            await post(action, {
              ...body,
              owner: { entityType: 'organization', entityId: projectId },
            })
          ).status
        ).toBe(400)
      }
      const joined = await join('reader', projectId, owner)
      const invalidation = new Promise<{ docId: string }>((resolve) =>
        joined.socket.once(FILE_DOC_EVENTS.INVALIDATED, resolve)
      )
      const response = await post('retire', {
        fileId,
        owner,
        retiredDocId: docId,
        replacementDocId: generateId(),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'applied' })
      expect((await invalidation).docId).toBe(docId)
    }
  )
})

afterAll(async () => {
  for (const socket of clients) socket.disconnect()
  await flushAllFileDocRooms()
  await new Promise<void>((resolve) => io.close(() => resolve()))
  await new Promise<void>((resolve) => app.close(() => resolve()))
  document.destroy()
  const reportPath =
    process.env.PROJECT_FILE_SOCKET_REPORT_PATH ?? resolve('test-results/project-file-socket.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})
