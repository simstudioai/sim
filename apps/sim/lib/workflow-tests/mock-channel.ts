import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type {
  ExecutionTestHooks,
  MockedBlockCall,
  MockedToolCall,
} from '@/executor/execution/types'

type PendingMockCall =
  | { kind: 'block'; call: MockedBlockCall }
  | { kind: 'tool'; call: MockedToolCall }

/** A mocked block or Agent tool call waiting for the test's answer. */
export type ParkedMockCall = PendingMockCall & { callId: string }

type MockReply = { output: Record<string, unknown> } | { error: string }

/**
 * The server half of a test run's mocks. The executor parks each mocked block and mocked Agent
 * tool call on `hooks`; the test sandbox pulls parked calls with `nextCall` and settles them
 * with `reply`.
 */
export interface MockChannel {
  readonly hooks: ExecutionTestHooks
  /** The next parked call, in arrival order. */
  nextCall(): Promise<ParkedMockCall>
  reply(callId: string, reply: MockReply): void
  /** Rejects every parked call and waiter; later calls reject immediately. */
  close(reason: Error): void
}

interface ParkedEntry {
  resolve: (output: Record<string, unknown>) => void
  reject: (error: Error) => void
  detach: () => void
}

interface Waiter {
  resolve: (call: ParkedMockCall) => void
  reject: (error: Error) => void
}

/** The test's side of the hooks: which blocks and tools it answers or records. */
export type MockMatcher = Pick<
  ExecutionTestHooks,
  'enterWorkflow' | 'mocksBlock' | 'mocksTool' | 'spiesBlock' | 'recordSpy'
>

export function createMockChannel(matcher: MockMatcher): MockChannel {
  const parked = new Map<string, ParkedEntry>()
  const undelivered: ParkedMockCall[] = []
  const waiters: Waiter[] = []
  let closedWith: Error | undefined

  const deliver = (call: ParkedMockCall) => {
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(call)
    else undelivered.push(call)
  }

  const settle = (callId: string): ParkedEntry => {
    const entry = parked.get(callId)
    if (!entry) throw new Error(`No parked mock call "${callId}"`)
    parked.delete(callId)
    entry.detach()
    const queued = undelivered.findIndex((call) => call.callId === callId)
    if (queued !== -1) undelivered.splice(queued, 1)
    return entry
  }

  const park = (
    pending: PendingMockCall,
    abortSignal?: AbortSignal
  ): Promise<Record<string, unknown>> => {
    if (closedWith) return Promise.reject(closedWith)
    if (abortSignal?.aborted) return Promise.reject(toError(abortSignal.reason))
    const callId = generateId()
    return new Promise((resolve, reject) => {
      const onAbort = () => settle(callId).reject(toError(abortSignal?.reason))
      abortSignal?.addEventListener('abort', onAbort, { once: true })
      parked.set(callId, {
        resolve,
        reject,
        detach: () => abortSignal?.removeEventListener('abort', onAbort),
      })
      deliver({ callId, ...pending })
    })
  }

  const hooks: ExecutionTestHooks = {
    enterWorkflow: (workflow) => matcher.enterWorkflow(workflow),
    mocksBlock: (blockId) => matcher.mocksBlock(blockId),
    resolveMock: (call, abortSignal) => park({ kind: 'block', call }, abortSignal),
    mocksTool: (blockId, toolId) => matcher.mocksTool(blockId, toolId),
    resolveToolMock: (call, abortSignal) => park({ kind: 'tool', call }, abortSignal),
    spiesBlock: (blockId) => matcher.spiesBlock(blockId),
    recordSpy: (call) => matcher.recordSpy(call),
  }

  return {
    hooks,
    nextCall() {
      if (closedWith) return Promise.reject(closedWith)
      const queued = undelivered.shift()
      if (queued) return Promise.resolve(queued)
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    },
    reply(callId, reply) {
      const entry = settle(callId)
      if ('error' in reply) entry.reject(new Error(reply.error))
      else entry.resolve(reply.output)
    },
    close(reason) {
      if (closedWith) return
      closedWith = reason
      for (const callId of [...parked.keys()]) settle(callId).reject(reason)
      for (const waiter of waiters.splice(0)) waiter.reject(reason)
    },
  }
}
