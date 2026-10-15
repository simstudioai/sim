import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { permissions, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import * as roomAuthorization from '@sim/platform-authz/rooms'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  type JoinFileDocSuccess,
} from '@sim/realtime-protocol/file-doc'
import { type FileDocOwner, fileDocRoom } from '@sim/realtime-protocol/file-doc-target'
import { roomName } from '@sim/realtime-protocol/rooms'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { startAccessRevalidationSweep } from '@/access-revalidation'
import { env } from '@/env'
import {
  cleanupFileDocForSocket,
  flushAllFileDocRooms,
  setupWorkspaceFileDocHandlers,
} from '@/handlers/file-doc'
import { getFileDocStore } from '@/handlers/file-doc-store'
import type { AuthenticatedSocket } from '@/middleware/auth'
import {
  beginRoomPermissionRead,
  commitRoomPermission,
  ROLE_REVALIDATION_TTL_MS,
} from '@/middleware/permissions'
import { MemoryRoomManager } from '@/rooms'

const workspaceId = generateId()
const projectId = generateId()
const readerId = generateId()
const writerId = generateId()
const clients: Socket[] = []
const documents: Y.Doc[] = []
const files: string[] = []
const seeds = new Map<string, Uint8Array>()
const persisted: { fileId: string; userId: string; body: string }[] = []
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
let app: HttpServer
let http: HttpServer
let io: Server
let manager: MemoryRoomManager
let socketUrl: string
let failProjectAccess = false

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return `http://127.0.0.1:${address.port}`
}

beforeAll(async () => {
  await db.insert(user).values(
    [readerId, writerId].map((id) => ({
      id,
      name: 'Fixture',
      email: `${id}@example.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Document capability fixture',
    ownerId: writerId,
    billedAccountUserId: writerId,
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: readerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    },
    {
      id: generateId(),
      userId: writerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write',
    },
  ])
  await getFileDocStore().init()
  app = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.headers['x-api-key'] !== env.INTERNAL_API_SECRET) {
      response.writeHead(401).end('{}')
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = request.url ?? ''
    const project = path.includes('/project-file-doc/')
    const fileId = project ? path.split('/')[5] : body.fileId
    const actor = project ? request.headers['x-sim-subject-user-id'] : body.userId
    if (path.endsWith('/access')) {
      if (failProjectAccess) {
        response.writeHead(503).end('{}')
        return
      }
      response.end(
        JSON.stringify({
          projectId,
          fileId,
          canRead: true,
          canWrite: actor === writerId,
          docId: generation(fileId),
        })
      )
    } else if (path.endsWith('/seed')) {
      response.end(
        JSON.stringify({
          update: Buffer.from(seeds.get(fileId) ?? []).toString('base64'),
          version: 1,
        })
      )
    } else if (path.endsWith('/persist')) {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, Buffer.from(body.docState, 'base64'))
      persisted.push({ fileId, userId: actor, body: doc.getText('body').toString() })
      doc.destroy()
      response.end(JSON.stringify({ status: 'persisted', version: 1 }))
    } else response.writeHead(404).end('{}')
  })
  env.NEXT_PUBLIC_APP_URL = await listen(app)
  http = createServer()
  io = new Server(http)
  manager = new MemoryRoomManager(io)
  io.on('connection', (socket) => {
    const authed = socket as AuthenticatedSocket
    authed.userId = socket.handshake.auth.actor
    authed.userName = 'Fixture'
    authed.userImage = 'https://example.invalid/avatar.png'
    setupWorkspaceFileDocHandlers(authed, manager)
    const handler = socket.listeners(FILE_DOC_EVENTS.MESSAGE)[0]
    if (!handler) throw new Error('Missing message handler')
    socket.off(FILE_DOC_EVENTS.MESSAGE, handler)
    socket.on(FILE_DOC_EVENTS.MESSAGE, async (frame, done) => {
      await handler(frame)
      done?.()
    })
    socket.on('disconnect', () => cleanupFileDocForSocket(socket.id, io))
  })
  socketUrl = await listen(http)
})

function generation(fileId: string) {
  return `doc-${fileId}`
}

async function fixture(entityType: FileDocOwner['entityType']) {
  const fileId = generateId()
  files.push(fileId)
  const owner = { entityType, entityId: entityType === 'workspace' ? workspaceId : projectId }
  if (entityType === 'workspace')
    await db.insert(workspaceFiles).values({
      id: fileId,
      workspaceId,
      userId: writerId,
      key: fileId,
      context: 'workspace',
      originalName: `${fileId}.md`,
      contentType: 'text/markdown',
    })
  const doc = new Y.Doc()
  documents.push(doc)
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, generation(fileId))
  seeds.set(fileId, Y.encodeStateAsUpdate(doc))
  return { fileId, owner }
}

async function join(target: Awaited<ReturnType<typeof fixture>>, actor: string) {
  const socket = connect(socketUrl, { transports: ['websocket'], auth: { actor } })
  clients.push(socket)
  await new Promise<void>((done) => socket.once('connect', done))
  const doc = new Y.Doc()
  documents.push(doc)
  socket.on(FILE_DOC_EVENTS.MESSAGE, (data: Uint8Array) => {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    if (decoding.readVarUint(decoder) !== FILE_DOC_MESSAGE_TYPE.SYNC) return
    const reply = encoding.createEncoder()
    syncProtocol.readSyncMessage(decoder, reply, doc, 'remote')
  })
  const joined = new Promise<JoinFileDocSuccess>((done, reject) => {
    socket.once(FILE_DOC_EVENTS.JOIN_SUCCESS, done)
    socket.once(FILE_DOC_EVENTS.JOIN_ERROR, (error) => reject(new Error(error.code)))
  })
  socket.emit(FILE_DOC_EVENTS.JOIN, {
    ...target,
    clientId: doc.clientID,
    schemaVersion: FILE_DOC_SCHEMA_VERSION,
  })
  return { socket, doc, joined: await joined }
}

function frame(type: number, subtype: number, update: Uint8Array) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  encoding.writeVarUint(encoder, subtype)
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

function edit(value: string) {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, value)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
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

for (const scope of ['workspace', 'project'] as const)
  describe(`${scope} document capabilities over Socket.IO, Redis and authorization`, () => {
    check(
      `${scope} readers receive edits and presence but cannot write through any protocol variant`,
      async () => {
        const target = await fixture(scope)
        const reader = await join(target, readerId)
        const writer = await join(target, writerId)
        expect(reader.joined.canWrite).toBe(false)
        expect(writer.joined.canWrite).toBe(true)
        const update = edit('forged')
        for (const type of [FILE_DOC_MESSAGE_TYPE.SYNC, FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST]) {
          for (const subtype of [syncProtocol.messageYjsSyncStep2, syncProtocol.messageYjsUpdate])
            await reader.socket
              .timeout(3000)
              .emitWithAck(FILE_DOC_EVENTS.MESSAGE, frame(type, subtype, update))
        }
        expect(
          await reader.socket.timeout(3000).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            ...target,
            docId: generation(target.fileId),
            updateId: generateId(),
            update,
          })
        ).toMatchObject({ status: 'rejected', code: 'ACCESS_REVOKED' })
        const awareness = new awarenessProtocol.Awareness(reader.doc)
        awareness.setLocalState({ cursor: { position: 1 } })
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, [reader.doc.clientID])
        )
        const presence = new Promise<void>((done) =>
          writer.socket.on(FILE_DOC_EVENTS.MESSAGE, (data: Uint8Array) => {
            if (
              decoding.readVarUint(decoding.createDecoder(new Uint8Array(data))) ===
              FILE_DOC_MESSAGE_TYPE.AWARENESS
            )
              done()
          })
        )
        await reader.socket
          .timeout(3000)
          .emitWithAck(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
        await presence
        awareness.destroy()
        expect(
          await writer.socket.timeout(3000).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            ...target,
            docId: generation(target.fileId),
            updateId: generateId(),
            update: edit('accepted'),
          })
        ).toMatchObject({ status: 'accepted' })
        await expect.poll(() => reader.doc.getText('body').toString()).toBe('accepted')
        await flushAllFileDocRooms()
        expect(persisted.filter((entry) => entry.fileId === target.fileId).at(-1)).toEqual({
          fileId: target.fileId,
          userId: writerId,
          body: 'accepted',
        })
      }
    )

    check(
      `${scope} legacy editors persist with their authenticated identity after a viewer joins`,
      async () => {
        const target = await fixture(scope)
        const writer = await join(target, writerId)
        await join(target, readerId)
        for (const subtype of [syncProtocol.messageYjsSyncStep2, syncProtocol.messageYjsUpdate])
          await writer.socket
            .timeout(3000)
            .emitWithAck(
              FILE_DOC_EVENTS.MESSAGE,
              frame(FILE_DOC_MESSAGE_TYPE.SYNC, subtype, edit('legacy'))
            )
        await flushAllFileDocRooms()
        expect(persisted.filter((entry) => entry.fileId === target.fileId).at(-1)).toEqual({
          fileId: target.fileId,
          userId: writerId,
          body: 'legacylegacy',
        })
      }
    )

    check(`${scope} downgrade retains live reads and a later revocation evicts`, async () => {
      const target = await fixture(scope)
      const writer = await join(target, writerId)
      const room = fileDocRoom(target)
      commitRoomPermission(writerId, room, 'read', beginRoomPermissionRead())
      const sweep = startAccessRevalidationSweep(manager)
      try {
        const permission: { canWrite: boolean }[] = []
        writer.socket.on(FILE_DOC_EVENTS.PERMISSION, (value) => permission.push(value))
        await sweep.runOnce()
        await expect.poll(() => permission.at(-1)?.canWrite, { timeout: 1000 }).toBe(false)
        expect(io.sockets.sockets.get(writer.socket.id ?? '')?.rooms.has(roomName(room))).toBe(true)
        expect(
          await writer.socket.timeout(3000).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            ...target,
            docId: generation(target.fileId),
            updateId: generateId(),
            update: edit('denied'),
          })
        ).toMatchObject({ status: 'rejected', code: 'ACCESS_REVOKED' })
        commitRoomPermission(writerId, room, 'write', beginRoomPermissionRead())
        expect(
          await writer.socket.timeout(3000).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
            ...target,
            docId: generation(target.fileId),
            updateId: generateId(),
            update: edit('restored'),
          })
        ).toMatchObject({ status: 'accepted' })
        commitRoomPermission(writerId, room, null, beginRoomPermissionRead())
        await sweep.runOnce()
        expect(io.sockets.sockets.get(writer.socket.id ?? '')?.rooms.has(roomName(room))).toBe(
          false
        )
      } finally {
        sweep.stop()
      }
    })

    check(
      `${scope} expired authorization plus service failure retains membership without granting writes`,
      async () => {
        const target = await fixture(scope)
        const writer = await join(target, writerId)
        const now = Date.now()
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now + ROLE_REVALIDATION_TTL_MS + 1)
        const authorization =
          scope === 'workspace'
            ? vi
                .spyOn(roomAuthorization, 'authorizeRoom')
                .mockRejectedValue(new Error('Fixture authorization outage'))
            : null
        failProjectAccess = true
        try {
          expect(
            await writer.socket.timeout(3000).emitWithAck(FILE_DOC_EVENTS.UPDATE, {
              ...target,
              docId: generation(target.fileId),
              updateId: generateId(),
              update: edit('uncertain'),
            })
          ).toMatchObject({ status: 'rejected', code: 'TEMPORARY_FAILURE', retryable: true })
          expect(
            io.sockets.sockets.get(writer.socket.id ?? '')?.rooms.has(roomName(fileDocRoom(target)))
          ).toBe(true)
        } finally {
          authorization?.mockRestore()
          clock.mockRestore()
          failProjectAccess = false
        }
      }
    )
  })

afterAll(async () => {
  for (const socket of clients) socket.disconnect()
  if (io) await new Promise<void>((done) => io.close(() => done()))
  await flushAllFileDocRooms()
  await getFileDocStore().shutdown()
  if (app) await new Promise<void>((done) => app.close(() => done()))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  for (const id of [readerId, writerId]) await db.delete(user).where(eq(user.id, id))
  for (const doc of documents) doc.destroy()
  const report =
    process.env.FILE_DOC_CAPABILITIES_REPORT_PATH ??
    resolve('test-results/file-doc-capabilities.json')
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
})
