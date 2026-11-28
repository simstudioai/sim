import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { session, user, verification } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AccessRevalidationSweep, startAccessRevalidationSweep } from '@/access-revalidation'
import { env } from '@/env'
import { authenticateSocket } from '@/middleware/auth'
import { RedisRoomManager } from '@/rooms'

const userId = generateId()
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const clients: Socket[] = []
let http: HttpServer
let io: Server
let manager: RedisRoomManager
let sweep: AccessRevalidationSweep
let socketUrl: string

/** Inserts a session row and returns it with a one-time socket token minted from it. */
async function createSession() {
  const id = generateId()
  const token = generateId()
  const oneTimeToken = generateId()
  const now = new Date()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await db.insert(session).values({ id, token, userId, expiresAt, createdAt: now, updatedAt: now })
  await db.insert(verification).values({
    id: generateId(),
    identifier: `one-time-token:${oneTimeToken}`,
    value: token,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    updatedAt: now,
  })
  return { id, oneTimeToken }
}

/** Opens a socket through the real handshake middleware and records how it later disconnects. */
async function openSocket(oneTimeToken: string) {
  const socket = connect(socketUrl, {
    auth: { token: oneTimeToken },
    reconnection: false,
    transports: ['websocket'],
  })
  clients.push(socket)
  const disconnected = new Promise<string>((done) => socket.on('disconnect', done))
  await new Promise<void>((done, fail) => {
    socket.on('connect', done)
    socket.on('connect_error', fail)
  })
  return { socket, disconnected }
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

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Fixture',
    email: `${userId}@example.invalid`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  http = createServer()
  io = new Server(http)
  io.use(authenticateSocket)
  manager = new RedisRoomManager(io, env.REDIS_URL)
  await manager.initialize()
  sweep = startAccessRevalidationSweep(manager)
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  socketUrl = `http://127.0.0.1:${address.port}`
})

describe('session liveness over Socket.IO and Postgres', () => {
  check('a socket whose session is deleted is disconnected; a live session stays', async () => {
    const revoked = await createSession()
    const kept = await createSession()
    const revokedSocket = await openSocket(revoked.oneTimeToken)
    const keptSocket = await openSocket(kept.oneTimeToken)

    await sweep.runOnce()
    expect([...io.sockets.sockets.keys()]).toContain(revokedSocket.socket.id)

    await db.delete(session).where(eq(session.id, revoked.id))
    await sweep.runOnce()

    expect(await revokedSocket.disconnected).toBe('io server disconnect')
    expect([...io.sockets.sockets.keys()]).toContain(keptSocket.socket.id)
  })

  check('a socket whose session expired is disconnected', async () => {
    const expiring = await createSession()
    const { disconnected } = await openSocket(expiring.oneTimeToken)

    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.id, expiring.id))
    await sweep.runOnce()

    expect(await disconnected).toBe('io server disconnect')
  })
})

afterAll(async () => {
  sweep?.stop()
  for (const socket of clients) socket.disconnect()
  if (io) await new Promise<void>((done) => io.close(() => done()))
  await manager?.shutdown()
  await db.delete(user).where(eq(user.id, userId))
  const report =
    process.env.SESSION_LIVENESS_REPORT_PATH ?? resolve('test-results/session-liveness.json')
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
})
