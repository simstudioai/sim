import { createServer } from 'http'
import { Server } from 'socket.io'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('Socket Server Integration Tests', () => {
  let httpServer: any
  let socketServer: Server
  let clientSocket: Socket
  let serverPort: number

  beforeAll(async () => {
    httpServer = createServer()
    socketServer = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        serverPort = httpServer.address()?.port
        resolve()
      })
    })

    socketServer.on('connection', (socket) => {
      socket.on('join-workflow', ({ workflowId }) => {
        socket.join(workflowId)
        socket.emit('joined-workflow', { workflowId })
      })

      socket.on('workflow-operation', (data) => {
        socket.to(data.workflowId || 'test-workflow').emit('workflow-operation', {
          ...data,
          senderId: socket.id,
        })
      })
    })

    clientSocket = io(`http://localhost:${serverPort}`, {
      transports: ['polling', 'websocket'],
    })

    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => {
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.close()
    }
    if (socketServer) {
      socketServer.close()
    }
    if (httpServer) {
      httpServer.close()
    }
  })

  it('should connect to socket server', () => {
    expect(clientSocket.connected).toBe(true)
  })

  it('should join workflow room', async () => {
    const workflowId = 'test-workflow-123'

    const joinedPromise = new Promise<void>((resolve) => {
      clientSocket.once('joined-workflow', (data) => {
        expect(data.workflowId).toBe(workflowId)
        resolve()
      })
    })

    clientSocket.emit('join-workflow', { workflowId })
    await joinedPromise
  })

  it('should broadcast workflow operations', async () => {
    const workflowId = 'test-workflow-456'

    const client2 = io(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      client2.once('connect', resolve)
    })

    try {
      const join1Promise = new Promise<void>((resolve) => {
        clientSocket.once('joined-workflow', () => resolve())
      })
      const join2Promise = new Promise<void>((resolve) => {
        client2.once('joined-workflow', () => resolve())
      })

      clientSocket.emit('join-workflow', { workflowId })
      client2.emit('join-workflow', { workflowId })

      await Promise.all([join1Promise, join2Promise])

      const operationPromise = new Promise<void>((resolve) => {
        client2.once('workflow-operation', (data) => {
          expect(data.operation).toBe('batch-add-blocks')
          expect(data.target).toBe('blocks')
          expect(data.payload.blocks[0].id).toBe('block-123')
          resolve()
        })
      })

      clientSocket.emit('workflow-operation', {
        workflowId,
        operation: 'batch-add-blocks',
        target: 'blocks',
        payload: {
          blocks: [
            { id: 'block-123', type: 'action', name: 'Test Block', position: { x: 0, y: 0 } },
          ],
          edges: [],
          loops: {},
          parallels: {},
          subBlockValues: {},
        },
        timestamp: Date.now(),
      })

      await operationPromise
    } finally {
      client2.close()
    }
  })

  it('should handle multiple concurrent connections', async () => {
    const numClients = 10
    const clients: Socket[] = []
    const workflowId = 'stress-test-workflow'

    try {
      const connectPromises = Array.from({ length: numClients }, () => {
        const client = io(`http://localhost:${serverPort}`)
        clients.push(client)
        return new Promise<void>((resolve) => {
          client.once('connect', resolve)
        })
      })

      await Promise.all(connectPromises)

      const joinPromises = clients.map((client) => {
        return new Promise<void>((resolve) => {
          client.once('joined-workflow', () => resolve())
        })
      })

      clients.forEach((client) => {
        client.emit('join-workflow', { workflowId })
      })

      await Promise.all(joinPromises)

      let receivedCount = 0
      const expectedCount = numClients - 1

      const operationPromise = new Promise<void>((resolve) => {
        clients.forEach((client, index) => {
          if (index === 0) return

          client.once('workflow-operation', () => {
            receivedCount++
            if (receivedCount === expectedCount) {
              resolve()
            }
          })
        })
      })

      clients[0].emit('workflow-operation', {
        workflowId,
        operation: 'batch-add-blocks',
        target: 'blocks',
        payload: {
          blocks: [
            { id: 'stress-block', type: 'action', name: 'Stress Block', position: { x: 0, y: 0 } },
          ],
          edges: [],
          loops: {},
          parallels: {},
          subBlockValues: {},
        },
        timestamp: Date.now(),
      })

      await operationPromise
      expect(receivedCount).toBe(expectedCount)
    } finally {
      clients.forEach((client) => client.close())
    }
  })

  it('should handle rapid operations without loss', async () => {
    const workflowId = 'rapid-test-workflow'
    const numOperations = 50

    const client2 = io(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      client2.once('connect', resolve)
    })

    try {
      const join1Promise = new Promise<void>((resolve) => {
        clientSocket.once('joined-workflow', () => resolve())
      })
      const join2Promise = new Promise<void>((resolve) => {
        client2.once('joined-workflow', () => resolve())
      })

      clientSocket.emit('join-workflow', { workflowId })
      client2.emit('join-workflow', { workflowId })

      await Promise.all([join1Promise, join2Promise])

      let receivedCount = 0
      const receivedOperations = new Set<string>()

      const operationsPromise = new Promise<void>((resolve) => {
        client2.on('workflow-operation', (data) => {
          receivedCount++
          receivedOperations.add(data.payload.blocks[0].id)

          if (receivedCount === numOperations) {
            resolve()
          }
        })
      })

      for (let i = 0; i < numOperations; i++) {
        clientSocket.emit('workflow-operation', {
          workflowId,
          operation: 'batch-add-blocks',
          target: 'blocks',
          payload: {
            blocks: [
              {
                id: `rapid-block-${i}`,
                type: 'action',
                name: `Rapid Block ${i}`,
                position: { x: 0, y: 0 },
              },
            ],
            edges: [],
            loops: {},
            parallels: {},
            subBlockValues: {},
          },
          timestamp: Date.now(),
        })
      }

      await operationsPromise
      expect(receivedCount).toBe(numOperations)
      expect(receivedOperations.size).toBe(numOperations)
    } finally {
      client2.close()
    }
  })
})
