/**
 * @vitest-environment node
 */
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupConnectionHandlers, waitForConnectionCleanup } from '@/handlers/connection'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { MemoryRoomManager } from '@/rooms'

vi.mock('@/handlers/file-doc', () => ({ cleanupFileDocForSocket: vi.fn() }))
vi.mock('@/handlers/subblocks', () => ({ cleanupPendingSubblocksForSocket: vi.fn() }))
vi.mock('@/handlers/variables', () => ({ cleanupPendingVariablesForSocket: vi.fn() }))

describe('server shutdown connection drain', () => {
  let httpServer: HttpServer
  let io: Server
  let manager: MemoryRoomManager
  let client: Socket

  beforeEach(async () => {
    httpServer = createServer()
    io = new Server(httpServer, { transports: ['websocket'] })
    manager = new MemoryRoomManager(io)
    await manager.initialize()
    io.on('connection', (socket) => setupConnectionHandlers(socket as AuthenticatedSocket, manager))
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const port = (httpServer.address() as AddressInfo).port
    client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: false })
    const connected = new Promise<void>((resolve) => client.once('connect', resolve))
    client.connect()
    await connected
  })

  afterEach(async () => {
    client.disconnect()
    await io.close()
    await waitForConnectionCleanup()
    await manager.shutdown()
    vi.restoreAllMocks()
  })

  it('keeps automatic reconnection active after transport shutdown', async () => {
    const disconnected = new Promise<string>((resolve) => client.once('disconnect', resolve))
    await io.close()
    expect(await disconnected).toBe('transport close')
    expect(client.active).toBe(true)
    await waitForConnectionCleanup()
  })

  it('waits for asynchronous presence cleanup before releasing its dependencies', async () => {
    let finishRemoval: (() => void) | undefined
    vi.spyOn(manager, 'removeSocketFromAllRooms').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRemoval = () => resolve([])
        })
    )
    await io.close()
    let drained = false
    const drain = waitForConnectionCleanup().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(finishRemoval).toBeDefined()
    finishRemoval?.()
    await drain
    expect(drained).toBe(true)
  })
})
