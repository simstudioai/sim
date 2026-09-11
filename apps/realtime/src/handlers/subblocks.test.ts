/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockSelect, mockSet } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockSet: vi.fn(),
}))

vi.mock('@sim/db', () => {
  const tx = { select: mockSelect, update: () => ({ set: mockSet }) }
  return {
    db: {
      ...tx,
      transaction: async (callback: (value: typeof tx) => Promise<void>) => callback(tx),
    },
  }
})
vi.mock('@sim/db/schema', () => ({
  workflow: { id: 'workflow.id' },
  workflowBlocks: { id: 'block.id' },
}))
vi.mock('@sim/platform-authz/workflow', () => ({
  assertWorkflowMutable: vi.fn().mockResolvedValue(undefined),
  WorkflowLockedError: class extends Error {},
}))
vi.mock('@/middleware/permissions', () => ({
  checkWorkflowOperationPermission: vi.fn().mockResolvedValue({ allowed: true }),
}))

import { setupSubblocksHandlers } from '@/handlers/subblocks'

type Handler = (payload: unknown) => Promise<void>

function setup() {
  const handlers: Record<string, Handler> = {}
  const emit = vi.fn()
  const delivery = { emit, except: vi.fn() }
  delivery.except.mockReturnValue(delivery)
  const socket = {
    id: 'socket-1',
    on: (event: string, handler: Handler) => {
      handlers[event] = handler
    },
    emit: vi.fn(),
  }
  const roomManager = {
    io: { to: vi.fn().mockReturnValue(delivery) },
    isReady: () => true,
    getRoomForSocket: vi.fn().mockResolvedValue({ id: 'workflow-1' }),
    getUserSession: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    hasRoom: vi.fn().mockResolvedValue(true),
    getRoomUsers: vi.fn().mockResolvedValue([{ socketId: 'socket-1', role: 'write' }]),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
  }
  setupSubblocksHandlers(
    socket as unknown as Parameters<typeof setupSubblocksHandlers>[0],
    roomManager as unknown as IRoomManager
  )
  return { handlers, emit }
}

const value = [{ usageControl: 'force' }]
const update = { blockId: 'agent-1', subblockId: 'tools', value, operationId: 'op-1', timestamp: 1 }

function holdNextWorkflowLookup() {
  let finish: (error?: Error) => void = () => {}
  const result = new Promise<Array<{ id: string }>>((resolve, reject) => {
    finish = (error) => (error ? reject(error) : resolve([{ id: 'workflow-1' }]))
  })
  mockSelect.mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: () => result }) }),
  })
  return finish
}

describe('debounced subblock writes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () =>
          Object.assign(
            Promise.resolve([
              {
                id: 'agent-1',
                type: 'agent',
                subBlocks: { tools: { value: [] } },
                data: {},
                locked: false,
              },
            ]),
            { limit: async () => [{ id: 'workflow-1' }] }
          ),
      }),
    }))
  })
  afterEach(() => vi.useRealTimers())

  it('persists subblock edits and confirms completion', async () => {
    const { handlers, emit } = setup()
    await handlers['subblock-update'](update)
    await vi.advanceTimersByTimeAsync(25)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ subBlocks: { tools: { value } } })
    )
    expect(emit).toHaveBeenCalledWith(
      'operation-confirmed',
      expect.objectContaining({ operationId: 'op-1' })
    )
  })

  it('treats a database failure as retryable and does not confirm a save', async () => {
    const { handlers, emit } = setup()
    mockSet.mockReturnValueOnce({ where: vi.fn().mockRejectedValue(new Error('connection reset')) })
    await handlers['subblock-update'](update)
    await vi.advanceTimersByTimeAsync(25)
    expect(mockSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ subBlocks: expect.anything() })
    )
    expect(emit).toHaveBeenCalledWith(
      'operation-failed',
      expect.objectContaining({ retryable: true })
    )
  })

  it('keeps the next debounced edit separate while the first database write is pending', async () => {
    const { handlers, emit } = setup()
    let resolveFirst: () => void = () => {}
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    mockSet.mockReturnValueOnce({ where: () => first })
    await handlers['subblock-update'](update)
    await vi.advanceTimersByTimeAsync(25)
    await handlers['subblock-update']({
      ...update,
      operationId: 'op-2',
      value: [{ usageControl: 'none' }],
    })
    resolveFirst()
    await vi.advanceTimersByTimeAsync(25)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        subBlocks: { tools: { value: [{ usageControl: 'none' }] } },
      })
    )
    expect(emit).toHaveBeenCalledWith(
      'operation-confirmed',
      expect.objectContaining({ operationId: 'op-1' })
    )
    expect(emit).toHaveBeenCalledWith(
      'operation-confirmed',
      expect.objectContaining({ operationId: 'op-2' })
    )
  })

  it('preserves save and confirmation order when the older workflow lookup stalls', async () => {
    const { handlers, emit } = setup()
    const finishLookup = holdNextWorkflowLookup()
    const newerValue = [{ usageControl: 'none' }]

    await handlers['subblock-update'](update)
    await vi.advanceTimersByTimeAsync(25)
    await handlers['subblock-update']({ ...update, operationId: 'op-2', value: newerValue })
    await vi.advanceTimersByTimeAsync(25)
    const writesBeforeRelease = mockSet.mock.calls.length
    finishLookup()
    await vi.advanceTimersByTimeAsync(0)

    expect(writesBeforeRelease).toBe(0)
    expect(
      mockSet.mock.calls
        .filter(([fields]) => fields.subBlocks)
        .map(([fields]) => fields.subBlocks.tools.value)
    ).toEqual([value, newerValue])
    expect(
      emit.mock.calls
        .filter(([event]) => event === 'operation-confirmed')
        .map(([, payload]) => payload.operationId)
    ).toEqual(['op-1', 'op-2'])
  })

  it.each([false, true])(
    'coalesces waiting edits and continues after an older failure: %s',
    async (failOlder) => {
      const { handlers, emit } = setup()
      const finishLookup = holdNextWorkflowLookup()
      const newestValue = [{ usageControl: 'auto' }]

      await handlers['subblock-update'](update)
      await vi.advanceTimersByTimeAsync(25)
      await handlers['subblock-update']({
        ...update,
        operationId: 'op-2',
        value: [{ usageControl: 'none' }],
      })
      await vi.advanceTimersByTimeAsync(25)
      await handlers['subblock-update']({ ...update, operationId: 'op-3', value: newestValue })
      await vi.advanceTimersByTimeAsync(25)
      finishLookup(failOlder ? new Error('connection reset') : undefined)
      await vi.advanceTimersByTimeAsync(0)

      expect(
        mockSet.mock.calls
          .filter(([fields]) => fields.subBlocks)
          .map(([fields]) => fields.subBlocks.tools.value)
      ).toEqual(failOlder ? [newestValue] : [value, newestValue])
      expect(
        emit.mock.calls
          .filter(([event]) => event === 'operation-confirmed')
          .map(([, payload]) => payload.operationId)
      ).toEqual(failOlder ? ['op-2', 'op-3'] : ['op-1', 'op-2', 'op-3'])
      if (failOlder) {
        expect(emit).toHaveBeenCalledWith(
          'operation-failed',
          expect.objectContaining({ operationId: 'op-1', retryable: true })
        )
      }
    }
  )

  it('allows a different subblock to save while one subblock is stalled', async () => {
    const { handlers, emit } = setup()
    const finishLookup = holdNextWorkflowLookup()
    await handlers['subblock-update'](update)
    await vi.advanceTimersByTimeAsync(25)
    await handlers['subblock-update']({
      ...update,
      subblockId: 'systemPrompt',
      operationId: 'op-other',
      value: 'hello',
    })
    await vi.advanceTimersByTimeAsync(25)
    const confirmedBeforeRelease = emit.mock.calls
      .filter(([event]) => event === 'operation-confirmed')
      .map(([, payload]) => payload.operationId)
    finishLookup()
    await vi.advanceTimersByTimeAsync(0)

    expect(confirmedBeforeRelease).toEqual(['op-other'])
    expect(emit).toHaveBeenCalledWith(
      'operation-confirmed',
      expect.objectContaining({ operationId: 'op-1' })
    )
  })
})
