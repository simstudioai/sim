import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  type FileDocPresence,
  type JoinFileDocSuccess,
} from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient, type RedisClientType } from 'redis'
import { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { AuthenticatedSocket } from '@/middleware/auth'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('Integration setup must provide disposable Redis')
const internalSecret = process.env.INTERNAL_API_SECRET

const projectId = generateId()
const fileId = generateId()
const roomName = `project-file-doc:${projectId}/${fileId}`
const docId = generateId()
const seedDoc = new Y.Doc()
seedDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
seedDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, docId)
const seed = Buffer.from(Y.encodeStateAsUpdate(seedDoc)).toString('base64')
seedDoc.destroy()

interface Replica {
  io: Server
  url: string
  pub: RedisClientType
  sub: RedisClientType
  shutdownStore: () => Promise<void>
}

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const clients: Socket[] = []
const replicas: Replica[] = []
let app: HttpServer

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return `http://127.0.0.1:${address.port}`
}

/**
 * One realtime replica: a fresh module graph (its own rooms, owners and document store, as in a
 * separate process) behind its own Socket.IO server on the shared Redis adapter.
 */
async function startReplica(): Promise<Replica> {
  vi.resetModules()
  const fileDoc = await import('@/handlers/file-doc')
  const fileDocStore = await import('@/handlers/file-doc-store')
  const { MemoryRoomManager } = await import('@/rooms')
  await fileDocStore.initFileDocStore(redisUrl)
  const pub: RedisClientType = createClient({ url: redisUrl })
  const sub: RedisClientType = createClient({ url: redisUrl })
  await Promise.all([pub.connect(), sub.connect()])
  const http = createServer()
  const io = new Server(http)
  io.adapter(createAdapter(pub, sub))
  fileDoc.registerFileDocPresenceRelay(io)
  const manager = new MemoryRoomManager(io)
  io.on('connection', (socket) => {
    const authed = socket as AuthenticatedSocket
    authed.userId = socket.handshake.auth.actor
    authed.userName = `Fixture ${socket.handshake.auth.actor}`
    authed.userImage = 'https://fixture.invalid/avatar.png'
    fileDoc.setupWorkspaceFileDocHandlers(authed, manager)
    socket.on('disconnect', () => fileDoc.cleanupFileDocForSocket(socket.id, io, true))
  })
  const replica = {
    io,
    url: await listen(http),
    pub,
    sub,
    shutdownStore: () => fileDocStore.getFileDocStore().shutdown(),
  }
  replicas.push(replica)
  return replica
}

beforeAll(async () => {
  app = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const prefix = `/api/internal/project-file-doc/${projectId}/${fileId}/`
    if (request.headers['x-api-key'] !== internalSecret || !request.url?.startsWith(prefix)) {
      response.writeHead(401).end('{}')
      return
    }
    const action = request.url.slice(prefix.length)
    if (action === 'access') {
      response.end(JSON.stringify({ projectId, fileId, canRead: true, canWrite: true, docId }))
    } else if (action === 'seed') {
      response.end(JSON.stringify({ update: seed, version: 1 }))
    } else if (action === 'persist') {
      response.end(JSON.stringify({ status: 'persisted', version: 2 }))
    } else {
      response.writeHead(404).end('{}')
    }
  })
  process.env.NEXT_PUBLIC_APP_URL = await listen(app)
})

/** Joins the shared file through `replica`, recording every roster the client receives. */
async function joinThrough(replica: Replica, actor: string) {
  const socket = connect(replica.url, { transports: ['websocket'], auth: { actor } })
  clients.push(socket)
  const rosters: string[][] = []
  socket.on(FILE_DOC_EVENTS.PRESENCE, (payload: FileDocPresence) => {
    if (payload.fileId === fileId) rosters.push(payload.users.map((user) => user.socketId).sort())
  })
  await new Promise<void>((done) => socket.once('connect', done))
  const joined = new Promise<JoinFileDocSuccess>((done, fail) => {
    socket.once(FILE_DOC_EVENTS.JOIN_SUCCESS, done)
    socket.once(FILE_DOC_EVENTS.JOIN_ERROR, (error) => fail(new Error(error.code)))
  })
  const clientDoc = new Y.Doc()
  const clientId = clientDoc.clientID
  clientDoc.destroy()
  socket.emit(FILE_DOC_EVENTS.JOIN, {
    fileId,
    projectId,
    clientId,
    schemaVersion: FILE_DOC_SCHEMA_VERSION,
  })
  await joined
  const id = socket.id
  if (!id) throw new Error('Connected socket has no id')
  return { socket, id, latestRoster: () => rosters.at(-1) }
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

describe('File editor presence across replicas sharing the Redis adapter', () => {
  check(
    'each replica lists collaborators joined through the other, and drops a departed one',
    async () => {
      const first = await startReplica()
      const second = await startReplica()
      const alice = await joinThrough(first, 'fixture-alice')
      const bob = await joinThrough(second, 'fixture-bob')
      const both = [alice.id, bob.id].sort()

      await expect.poll(alice.latestRoster, { timeout: 5_000 }).toEqual(both)
      await expect.poll(bob.latestRoster, { timeout: 5_000 }).toEqual(both)

      bob.socket.disconnect()
      await expect.poll(alice.latestRoster, { timeout: 5_000 }).toEqual([alice.id])
    }
  )
})

afterAll(async () => {
  for (const client of clients) client.disconnect()
  for (const replica of replicas) {
    await replica.io.close()
    await replica.shutdownStore()
  }
  const cleanup = replicas[0]?.pub
  if (cleanup?.isOpen) {
    const keys = await cleanup.keys(`filedoc:*:${roomName}`)
    if (keys.length) await cleanup.del(keys)
  }
  for (const replica of replicas) {
    for (const client of [replica.pub, replica.sub]) if (client.isOpen) await client.quit()
  }
  await new Promise<void>((done) => app.close(() => done()))
  const reportPath =
    process.env.FILE_DOC_PRESENCE_REPORT_PATH ?? resolve('test-results/file-doc-presence.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})
