import type { DesktopToolCompletion } from '@sim/desktop-bridge/tool-results'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'
import { type DesktopExecutorClient, DeviceRequestError } from '@/main/desktop-executor/client'
import { DesktopExecutor, type DesktopToolRunner } from '@/main/desktop-executor/executor'
import type { ExecutorJournal, JournalEntry } from '@/main/desktop-executor/journal'
import type {
  ClaimedDesktopCall,
  DesktopCompletionRequest,
  DesktopInboxItem,
} from '@/main/desktop-executor/protocol'

/**
 * Failure modes of the executor's state machine, each against fakes of its three boundaries:
 * Sim's device routes, the encrypted journal, and the tools on this machine.
 */

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function callItem(
  toolCallId: string,
  chatId: string,
  toolName = 'browser_click'
): DesktopInboxItem {
  return { kind: 'call', toolCallId, toolName, chatId, workspaceId: 'ws-1' }
}

const DONE: DesktopToolCompletion = { status: 'success', message: 'done', data: { ok: true } }

class FakeSim {
  inbox: DesktopInboxItem[] = []
  readonly claims: string[] = []
  readonly renewals: string[] = []
  readonly completions: DesktopCompletionRequest[] = []
  claimError: ((toolCallId: string) => DeviceRequestError | null) | null = null
  renewError: ((toolCallId: string) => DeviceRequestError | null) | null = null
  completeErrors: DeviceRequestError[] = []
  completionOutcome: 'recorded' | 'duplicate' | 'superseded' = 'recorded'

  readonly client: DesktopExecutorClient = {
    register: async () => {
      throw new Error('not used')
    },
    listInbox: async () => [...this.inbox],
    openInboxStream: async () => {
      throw new Error('not used')
    },
    claim: async (toolCallId) => {
      this.claims.push(toolCallId)
      const error = this.claimError?.(toolCallId)
      if (error) throw error
      const item = this.inbox.find(
        (entry): entry is Extract<DesktopInboxItem, { kind: 'call' }> =>
          entry.kind === 'call' && entry.toolCallId === toolCallId
      )
      if (!item) throw new DeviceRequestError(404, 'gone')
      this.inbox = this.inbox.filter((entry) => entry !== item)
      return {
        toolCallId,
        toolName: item.toolName,
        args: { step: toolCallId },
        chatId: item.chatId,
        workspaceId: item.workspaceId,
        executionToken: `token-${toolCallId}`,
      } satisfies ClaimedDesktopCall
    },
    renewLease: async (toolCallId) => {
      this.renewals.push(toolCallId)
      const error = this.renewError?.(toolCallId)
      if (error) throw error
    },
    complete: async (request) => {
      const error = this.completeErrors.shift()
      if (error) throw error
      this.completions.push(request)
      return this.completionOutcome
    },
  }
}

class MemoryJournal implements ExecutorJournal {
  readonly entries = new Map<string, JournalEntry>()
  readonly history: JournalEntry[] = []
  /** A transition the disk refuses, as a full disk or a failed encryption would. */
  failOn: JournalEntry['state'] | null = null
  async load() {
    return [...this.entries.values()]
  }
  async put(entry: JournalEntry) {
    if (entry.state === this.failOn) throw new Error('disk full')
    this.entries.set(entry.toolCallId, entry)
    this.history.push(entry)
  }
  async remove(toolCallId: string) {
    this.entries.delete(toolCallId)
  }
  async clear() {
    this.entries.clear()
  }
}

class FakeRunner implements DesktopToolRunner {
  readonly started: string[] = []
  readonly cancelled: string[] = []
  readonly pending = new Map<string, Deferred<DesktopToolCompletion>>()
  /** When set, every call finishes at once with this completion. */
  immediate: DesktopToolCompletion | null = null
  onStart: ((call: ClaimedDesktopCall) => void) | null = null
  /** An action that finishes with its full result even after being told to stop. */
  ignoresAbort = false

  async run(call: ClaimedDesktopCall, signal: AbortSignal) {
    this.started.push(call.toolCallId)
    this.onStart?.(call)
    if (this.immediate) return this.immediate
    const result = deferred<DesktopToolCompletion>()
    this.pending.set(call.toolCallId, result)
    signal.addEventListener('abort', () => {
      if (!this.ignoresAbort)
        result.resolve({ status: 'error', message: 'This browser action was cancelled.' })
    })
    return result.promise
  }

  async cancel(call: ClaimedDesktopCall) {
    this.cancelled.push(call.toolCallId)
  }

  finish(toolCallId: string, completion: DesktopToolCompletion = DONE) {
    const result = this.pending.get(toolCallId)
    if (!result) throw new Error(`${toolCallId} is not running`)
    result.resolve(completion)
  }
}

function setup(options: { leaseRenewMs?: number; maxHeldCalls?: number } = {}) {
  const sim = new FakeSim()
  const journal = new MemoryJournal()
  const runner = new FakeRunner()
  const onUnregistered = vi.fn()
  const busy: boolean[] = []
  const executor = new DesktopExecutor({
    client: sim.client,
    journal,
    runner,
    leaseRenewMs: options.leaseRenewMs ?? 60_000,
    retryBaseMs: 5,
    onUnregistered,
    onBusyChange: (value) => busy.push(value),
    ...(options.maxHeldCalls ? { maxHeldCalls: options.maxHeldCalls } : {}),
  })
  return { sim, journal, runner, executor, onUnregistered, busy }
}

describe('claiming', () => {
  it('claims an offered call, runs it from the server record, and reports with its token', async () => {
    const { sim, journal, runner, executor } = setup()
    runner.immediate = DONE
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    expect(sim.completions[0]).toEqual({
      toolCallId: 'call-1',
      executionToken: 'token-call-1',
      completion: DONE,
    })
    await vi.waitFor(() => expect(journal.entries.size).toBe(0))
    expect(executor.heldCallCount()).toBe(0)
  })

  it('claims a whole backlog at once, before any of it runs', async () => {
    const { sim, runner, executor } = setup()
    sim.inbox = [callItem('a-1', 'chat-a'), callItem('a-2', 'chat-a'), callItem('a-3', 'chat-a')]

    await executor.reconcile()

    expect(sim.claims).toEqual(['a-1', 'a-2', 'a-3'])
    await vi.waitFor(() => expect(runner.started).toEqual(['a-1']))
  })

  it('runs one chat in inbox order and different chats side by side', async () => {
    const { sim, runner, executor } = setup()
    sim.inbox = [
      callItem('a-1', 'chat-a'),
      callItem('b-1', 'chat-b', 'terminal'),
      callItem('a-2', 'chat-a'),
    ]

    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['a-1', 'b-1']))

    runner.finish('b-1')
    runner.finish('a-1')
    await vi.waitFor(() => expect(runner.started).toEqual(['a-1', 'b-1', 'a-2']))
  })

  it('does not claim a call it already holds when the inbox lists it again', async () => {
    const { sim, executor } = setup()
    const item = callItem('call-1', 'chat-a')
    sim.inbox = [item]
    await executor.reconcile()
    sim.inbox = [item]

    await executor.reconcile()

    expect(sim.claims).toEqual(['call-1'])
  })

  it.each([
    [404, 'claimed elsewhere or settled'],
    [403, 'still awaiting approval'],
    [409, 'turn ended'],
  ])('drops a claim Sim refuses with %i (%s) without running anything', async (status) => {
    const { sim, journal, runner, executor } = setup()
    sim.claimError = () => new DeviceRequestError(status, 'refused')
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    expect(runner.started).toEqual([])
    expect(journal.entries.size).toBe(0)
    expect(executor.heldCallCount()).toBe(0)
  })

  it('stops claiming at its in-flight cap and claims the rest once a slot frees', async () => {
    const { sim, runner, executor } = setup({ maxHeldCalls: 2 })
    sim.inbox = [callItem('a-1', 'chat-a'), callItem('b-1', 'chat-b'), callItem('c-1', 'chat-c')]

    await executor.reconcile()
    expect(sim.claims).toEqual(['a-1', 'b-1'])

    await vi.waitFor(() => expect(runner.started).toContain('a-1'))
    runner.finish('a-1')
    await vi.waitFor(() => expect(executor.heldCallCount()).toBe(1))
    await executor.reconcile()
    expect(sim.claims).toEqual(['a-1', 'b-1', 'c-1'])
  })

  it('does not claim while paused for sleep', async () => {
    const { sim, executor } = setup()
    sim.inbox = [callItem('call-1', 'chat-a')]
    executor.setPaused(true)

    await executor.reconcile()

    expect(sim.claims).toEqual([])
  })

  it('records that a call started before the action begins', async () => {
    const { sim, journal, runner, executor } = setup()
    let stateAtStart: JournalEntry['state'] | undefined
    runner.onStart = (call) => {
      stateAtStart = journal.entries.get(call.toolCallId)?.state
    }
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    await vi.waitFor(() => expect(stateAtStart).toBe('started'))
  })
})

describe('leases', () => {
  it('renews the lease while a call waits in its chat queue and while it runs', async () => {
    const { sim, runner, executor } = setup({ leaseRenewMs: 20 })
    sim.inbox = [callItem('a-1', 'chat-a'), callItem('a-2', 'chat-a')]

    await executor.reconcile()

    await vi.waitFor(() => {
      expect(sim.renewals).toContain('a-1')
      expect(sim.renewals).toContain('a-2')
    })
    expect(runner.started).toEqual(['a-1'])
    runner.finish('a-1')
    await vi.waitFor(() => expect(runner.started).toEqual(['a-1', 'a-2']))
    runner.finish('a-2')
    await vi.waitFor(() => expect(executor.heldCallCount()).toBe(0))
    const renewalsAfterAck = sim.renewals.length
    await sleep(80)
    expect(sim.renewals.length).toBe(renewalsAfterAck)
  })

  it('stops the action when Sim revokes its lease', async () => {
    const { sim, runner, executor } = setup({ leaseRenewMs: 20 })
    sim.inbox = [callItem('call-1', 'chat-a')]
    sim.renewError = () => new DeviceRequestError(410, 'revoked')

    await executor.reconcile()

    await vi.waitFor(() => expect(runner.cancelled).toEqual(['call-1']))
    await vi.waitFor(() => expect(sim.completions.map((c) => c.toolCallId)).toEqual(['call-1']))
    expect(executor.heldCallCount()).toBe(0)
  })
})

describe('reporting', () => {
  it('retries a result Sim did not acknowledge, without running the action again', async () => {
    const { sim, journal, runner, executor } = setup()
    runner.immediate = DONE
    sim.completeErrors = [
      new DeviceRequestError(0, 'offline'),
      new DeviceRequestError(503, 'deploying'),
    ]
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()
    await vi.waitFor(() => expect(journal.history.map((entry) => entry.state)).toContain('result'))

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    expect(runner.started).toEqual(['call-1'])
    await vi.waitFor(() => expect(journal.entries.size).toBe(0))
  })

  it.each(['duplicate', 'superseded'] as const)(
    'treats a %s completion as acknowledged',
    async (outcome) => {
      const { sim, journal, runner, executor } = setup()
      runner.immediate = DONE
      sim.completionOutcome = outcome
      sim.inbox = [callItem('call-1', 'chat-a')]

      await executor.reconcile()

      await vi.waitFor(() => expect(journal.entries.size).toBe(0))
      expect(sim.completions).toHaveLength(1)
    }
  )
})

describe('stopping', () => {
  it('stops a running call the inbox lists as cancelled, and acknowledges it', async () => {
    const { sim, runner, executor } = setup()
    sim.inbox = [callItem('call-1', 'chat-a')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['call-1']))

    sim.inbox = [{ kind: 'cancel', toolCallId: 'call-1' }]
    await executor.reconcile()

    await vi.waitFor(() => expect(runner.cancelled).toEqual(['call-1']))
    await vi.waitFor(() => expect(sim.completions.map((c) => c.toolCallId)).toEqual(['call-1']))
    await vi.waitFor(() => expect(executor.heldCallCount()).toBe(0))
  })

  it('never starts a queued call that was stopped, and acknowledges the stop', async () => {
    const { sim, runner, executor } = setup()
    sim.inbox = [callItem('a-1', 'chat-a'), callItem('a-2', 'chat-a')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['a-1']))

    sim.inbox = [{ kind: 'cancel', toolCallId: 'a-2' }]
    await executor.reconcile()
    await vi.waitFor(() => expect(sim.completions.map((c) => c.toolCallId)).toEqual(['a-2']))
    expect(sim.completions[0]?.completion.status).toBe('cancelled')

    runner.finish('a-1')
    await vi.waitFor(() => expect(executor.heldCallCount()).toBe(0))
    expect(runner.started).toEqual(['a-1'])
  })

  it('sends nothing the stopped action produced, only the acknowledgement', async () => {
    const { sim, runner, executor } = setup()
    runner.ignoresAbort = true
    sim.inbox = [callItem('call-1', 'chat-a', 'read_local_file')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['call-1']))

    sim.inbox = [{ kind: 'cancel', toolCallId: 'call-1' }]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.cancelled).toEqual(['call-1']))
    runner.finish('call-1', { status: 'success', message: 'read', data: { text: 'secret' } })

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    expect(sim.completions[0]?.completion.status).toBe('cancelled')
    expect(JSON.stringify(sim.completions[0])).not.toContain('secret')
  })

  it('ignores a cancel for a call it never held', async () => {
    const { sim, runner, executor } = setup()
    sim.inbox = [{ kind: 'cancel', toolCallId: 'someone-else' }]

    await executor.reconcile()

    expect(runner.cancelled).toEqual([])
    expect(sim.completions).toEqual([])
  })
})

describe('restarting', () => {
  it('reports what each journaled call reached, and never runs any of them again', async () => {
    const { sim, journal, runner, executor } = setup()
    await journal.put({ toolCallId: 'claiming-1', state: 'claiming' })
    await journal.put({ toolCallId: 'claimed-1', state: 'claimed', executionToken: 't-claimed' })
    await journal.put({ toolCallId: 'started-1', state: 'started', executionToken: 't-started' })
    await journal.put({
      toolCallId: 'result-1',
      state: 'result',
      executionToken: 't-result',
      completion: DONE,
    })

    await executor.recover()

    await vi.waitFor(() => expect(sim.completions).toHaveLength(3))
    const reported = new Map(sim.completions.map((request) => [request.toolCallId, request]))
    expect(reported.get('claimed-1')?.completion.data).toMatchObject({ notStarted: true })
    expect(reported.get('claimed-1')?.executionToken).toBe('t-claimed')
    expect(reported.get('started-1')?.completion.data).toMatchObject({
      outcomeUnknown: true,
      doNotRetry: true,
    })
    expect(reported.get('result-1')?.completion).toEqual(DONE)
    expect(reported.has('claiming-1')).toBe(false)
    expect(runner.started).toEqual([])
    await vi.waitFor(() => expect(journal.entries.size).toBe(0))
  })
})

describe('delivery', () => {
  it('retries a result whose request timed out', async () => {
    const { sim, journal, executor } = setup()
    sim.completeErrors = [new DeviceRequestError(408, 'request timeout')]
    await journal.put({
      toolCallId: 'r-1',
      state: 'result',
      executionToken: 't-1',
      completion: DONE,
    })

    await executor.recover()

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
  })

  it('holds a result Sim refuses as unregistered until the device registers again', async () => {
    const { sim, journal, executor, onUnregistered } = setup()
    sim.completeErrors = [new DeviceRequestError(401, 'unregistered')]
    await journal.put({
      toolCallId: 'r-1',
      state: 'result',
      executionToken: 't-1',
      completion: DONE,
    })

    await executor.recover()
    await vi.waitFor(() => expect(onUnregistered).toHaveBeenCalledTimes(1))
    await sleep(40)

    expect(onUnregistered).toHaveBeenCalledTimes(1)
    expect(sim.completions).toHaveLength(0)
    expect(journal.entries.get('r-1')?.state).toBe('result')

    executor.resumeParked()

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    await vi.waitFor(() => expect(journal.entries.size).toBe(0))
  })
})

describe('keeping the machine awake', () => {
  it('is busy from the claim until Sim has the result', async () => {
    const { sim, runner, executor, busy } = setup()
    sim.inbox = [callItem('call-1', 'chat-a')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['call-1']))
    expect(busy).toEqual([true])

    runner.finish('call-1')

    await vi.waitFor(() => expect(busy).toEqual([true, false]))
    expect(sim.completions).toHaveLength(1)
  })

  it('goes idle at sign-out and stays silent when a recovered delivery settles afterwards', async () => {
    const { sim, journal, executor, busy } = setup()
    const answer = deferred<void>()
    const complete = sim.client.complete
    let sending = false
    sim.client.complete = async (request) => {
      sending = true
      await answer.promise
      return complete(request)
    }
    await journal.put({
      toolCallId: 'r-1',
      state: 'result',
      executionToken: 't-1',
      completion: DONE,
    })
    await executor.recover()
    await vi.waitFor(() => expect(sending).toBe(true))
    expect(busy).toEqual([true])

    await executor.dispose()
    expect(busy).toEqual([true, false])
    answer.resolve()
    await sleep(40)

    expect(busy).toEqual([true, false])
  })

  it('stays busy while a result a previous run left is still on its way to Sim', async () => {
    const { sim, journal, executor, busy } = setup()
    sim.completeErrors = [new DeviceRequestError(503, 'deploying')]
    await journal.put({
      toolCallId: 'result-1',
      state: 'result',
      executionToken: 't-result',
      completion: DONE,
    })

    await executor.recover()
    expect(busy).toEqual([true])

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    await vi.waitFor(() => expect(busy).toEqual([true, false]))
  })
})

describe('registration', () => {
  it('asks to register again when Sim no longer recognizes the device', async () => {
    const { sim, executor, onUnregistered } = setup()
    sim.claimError = () => new DeviceRequestError(401, 'unregistered')
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    expect(onUnregistered).toHaveBeenCalled()
  })

  it('drops everything it holds on sign-out', async () => {
    const { sim, journal, runner, executor } = setup()
    sim.inbox = [callItem('call-1', 'chat-a')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['call-1']))

    await executor.dispose()

    expect(runner.cancelled).toEqual(['call-1'])
    expect(journal.entries.size).toBe(0)
    expect(executor.heldCallCount()).toBe(0)
  })

  it('stops running actions at sign-out without waiting on a claim still in flight', async () => {
    const { sim, journal, runner, executor } = setup()
    sim.inbox = [callItem('call-1', 'chat-a')]
    await executor.reconcile()
    await vi.waitFor(() => expect(runner.started).toEqual(['call-1']))
    const answer = deferred<void>()
    const claim = sim.client.claim
    sim.client.claim = async (toolCallId) => {
      await answer.promise
      return claim(toolCallId)
    }
    sim.inbox = [callItem('call-2', 'chat-b')]
    const reading = executor.reconcile()
    await vi.waitFor(() => expect(journal.entries.get('call-2')?.state).toBe('claiming'))

    const signingOut = executor.dispose()
    await vi.waitFor(() => expect(runner.cancelled).toEqual(['call-1']))
    answer.resolve()
    await Promise.all([reading, signingOut])

    expect(runner.started).toEqual(['call-1'])
    expect(executor.heldCallCount()).toBe(0)
    expect(journal.entries.size).toBe(0)
  })

  it('does not keep a claim that Sim answers after sign-out', async () => {
    const { sim, journal, runner, executor } = setup({ leaseRenewMs: 10 })
    const answer = deferred<void>()
    const claim = sim.client.claim
    sim.client.claim = async (toolCallId) => {
      await answer.promise
      return claim(toolCallId)
    }
    sim.inbox = [callItem('call-1', 'chat-a')]
    const reading = executor.reconcile()
    await vi.waitFor(() => expect(journal.entries.get('call-1')?.state).toBe('claiming'))

    const signingOut = executor.dispose()
    answer.resolve()
    await Promise.all([reading, signingOut])
    await sleep(40)

    expect(executor.heldCallCount()).toBe(0)
    expect(runner.started).toEqual([])
    expect(sim.renewals).toEqual([])
    expect(journal.entries.size).toBe(0)
  })
})

describe('recording', () => {
  it('leaves a call on offer when it cannot record the claim', async () => {
    const { sim, journal, executor } = setup()
    journal.failOn = 'claiming'
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    expect(sim.claims).toEqual([])
  })

  it('never starts an action it could not record, and reports it as not run', async () => {
    const { sim, journal, runner, executor } = setup()
    journal.failOn = 'started'
    sim.inbox = [callItem('call-1', 'chat-a')]

    await executor.reconcile()

    await vi.waitFor(() => expect(sim.completions).toHaveLength(1))
    expect(sim.completions[0]?.completion.data).toMatchObject({ notStarted: true })
    expect(runner.started).toEqual([])
  })
})
