import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

/** How many journal loads still fail, like a read that throws. */
const journalFaults = vi.hoisted(() => ({ loads: 0 }))

vi.mock('@/main/desktop-executor/journal', async () => {
  const actual = await vi.importActual<typeof import('@/main/desktop-executor/journal')>(
    '@/main/desktop-executor/journal'
  )
  return {
    ...actual,
    createExecutorJournal: (...args: Parameters<typeof actual.createExecutorJournal>) => {
      const journal = actual.createExecutorJournal(...args)
      return {
        ...journal,
        load: () => {
          if (journalFaults.loads <= 0) return journal.load()
          journalFaults.loads -= 1
          return Promise.reject(new Error('The disk went away.'))
        },
      }
    },
  }
})

import { net } from 'electron'
import { DesktopExecutor } from '@/main/desktop-executor/executor'
import { createExecutorJournal } from '@/main/desktop-executor/journal'
import { createDesktopExecutorService, deviceName } from '@/main/desktop-executor/service'

/** Sim's device routes, with registration answers held until the test releases them. */
function fakeSim(protocolVersion = 1) {
  const requests: string[] = []
  /** Calls the inbox offers; a claim answers for the first one. */
  const offered: string[] = []
  /**
   * Answers to pending registrations: enabled or not, an HTTP status Sim fails with, or
   * `'offline'` for a request that never reached Sim.
   */
  const registrations: Array<(answer: boolean | number | 'offline') => void> = []
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname
    requests.push(`${init.method} ${path}`)
    if (path === '/api/desktop/devices') {
      const answer = await new Promise<boolean | number | 'offline'>((resolve) =>
        registrations.push(resolve)
      )
      if (answer === 'offline') throw new TypeError('fetch failed')
      if (typeof answer === 'number') {
        return Response.json({ error: 'Not found' }, { status: answer })
      }
      const enabled = answer
      return Response.json({
        enabled,
        protocolVersion,
        leaseMs: 60_000,
        leaseRenewMs: 20_000,
        reconcileMs: 10_000,
      })
    }
    if (path === '/api/desktop/inbox') {
      return Response.json({
        items: offered.map((toolCallId) => ({
          kind: 'call',
          toolCallId,
          toolName: 'terminal',
          chatId: 'chat-a',
          workspaceId: 'ws-1',
          createdAt: new Date().toISOString(),
        })),
      })
    }
    if (path === '/api/desktop/tool/claim') {
      const toolCallId = offered.shift()
      if (!toolCallId) return Response.json({ error: 'gone' }, { status: 404 })
      return Response.json({
        toolName: 'terminal',
        args: { operation: 'run', args: { command: 'sleep 600' } },
        chatId: 'chat-a',
        workspaceId: 'ws-1',
        executionToken: `token-${toolCallId}`,
      })
    }
    if (path === '/api/desktop/tool/lease') return Response.json({ renewed: true })
    if (path === '/api/desktop/tool/complete') return Response.json({ outcome: 'recorded' })
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    )
  })
  return { fetch, requests, registrations, offered }
}

async function service(protocolVersion = 1, userDataPath?: string) {
  const sim = fakeSim(protocolVersion)
  /** What the sleep blocker was told, in order. */
  const busy: boolean[] = []
  const desktopExecutor = createDesktopExecutorService({
    userDataPath: userDataPath ?? (await mkdtemp(join(tmpdir(), 'sim-executor-service-'))),
    origin: () => 'https://sim.test',
    appSession: () => ({ fetch: sim.fetch }),
    preferences: () => ({ browserEnabled: true, terminalEnabled: true }),
    accountDataAvailable: () => true,
    // A command that runs until it is stopped.
    runner: {
      run: (_call, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve({ status: 'cancelled', message: 'Stopped.' })
          )
        ),
      cancel: async () => {},
    },
    onBusyChange: (value) => busy.push(value),
  })
  return { sim, desktopExecutor, busy }
}

describe('results recovery will hand to the model', () => {
  it('names the calls whose real result the journal holds for recovery to send', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sim-executor-service-'))
    const journal = createExecutorJournal(join(userData, 'desktop-executor-journal.json'))
    await journal.put({ toolCallId: 'claimed', state: 'claimed', executionToken: 't1' })
    await journal.put({ toolCallId: 'started', state: 'started', executionToken: 't2' })
    await journal.put({
      toolCallId: 'unknown',
      state: 'result',
      executionToken: 't3',
      completion: { status: 'error', message: 'x', data: { outcomeUnknown: true } },
    })
    await journal.put({
      toolCallId: 'not-started',
      state: 'result',
      executionToken: 't4',
      completion: { status: 'error', message: 'x', data: { notStarted: true } },
    })
    await journal.put({
      toolCallId: 'stopped',
      state: 'result',
      executionToken: 't6',
      completion: { status: 'cancelled', message: 'Stopped.' },
    })
    await journal.put({
      toolCallId: 'too-large',
      state: 'result',
      executionToken: 't7',
      completion: { status: 'error', message: 'x', data: { resultOmitted: true } },
    })
    await journal.put({
      toolCallId: 'handed-back',
      state: 'result',
      executionToken: 't5',
      completion: { status: 'success', message: 'running', data: { status: 'running' } },
    })
    const { desktopExecutor } = await service(1, userData)

    expect([...(await desktopExecutor.pendingResults())]).toEqual(['handed-back'])
  })

  it('counts an unreadable journal as holding none', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sim-executor-service-'))
    // A directory where the journal file should be: every read of it fails.
    await mkdir(join(userData, 'desktop-executor-journal.json'))
    const { desktopExecutor } = await service(1, userData)

    expect([...(await desktopExecutor.pendingResults())]).toEqual([])
  })

  it('names what the journal held before recovery sent it, even when asked after', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sim-executor-service-'))
    const path = join(userData, 'desktop-executor-journal.json')
    await createExecutorJournal(path).put({
      toolCallId: 'handed-back',
      state: 'result',
      executionToken: 't1',
      completion: { status: 'success', message: 'running', data: { status: 'running' } },
    })
    // Recovery returns only once Sim has the result and the journal no longer holds it, so a
    // snapshot taken any time after recovery started would come back empty.
    const recover = DesktopExecutor.prototype.recover
    const recovered = vi
      .spyOn(DesktopExecutor.prototype, 'recover')
      .mockImplementation(async function (this: DesktopExecutor) {
        await recover.call(this)
        await vi.waitFor(async () => expect(await createExecutorJournal(path).load()).toEqual([]))
      })
    try {
      const { sim, desktopExecutor } = await service(1, userData)
      desktopExecutor.start()
      await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))
      sim.registrations[0]?.(true)
      await vi.waitFor(() => expect(sim.requests).toContain('POST /api/desktop/tool/complete'))
      await vi.waitFor(async () => expect(await createExecutorJournal(path).load()).toEqual([]))

      expect([...(await desktopExecutor.pendingResults())]).toEqual(['handed-back'])
      await desktopExecutor.signOut()
    } finally {
      recovered.mockRestore()
    }
  })

  it('counts a journal that cannot be loaded at all as holding none, and still starts', async () => {
    journalFaults.loads = 1
    const { sim, desktopExecutor } = await service()

    expect([...(await desktopExecutor.pendingResults())]).toEqual([])
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))
    sim.registrations[0]?.(true)

    await vi.waitFor(() => expect(sim.requests).toContain('GET /api/desktop/inbox'))
    await desktopExecutor.signOut()
  })
})

describe('desktop executor registration', () => {
  it('offers the device for binding once Sim enables it', async () => {
    const { sim, desktopExecutor } = await service()
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))

    sim.registrations[0]?.(true)

    await vi.waitFor(() => expect(desktopExecutor.getDevice()).not.toBeNull())
    await vi.waitFor(() => expect(sim.requests).toContain('GET /api/desktop/inbox'))
  })

  it('never resumes for a registration that Sim answers after sign-out', async () => {
    const { sim, desktopExecutor } = await service()
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))

    await desktopExecutor.signOut()
    sim.registrations[0]?.(true)
    await sleep(50)

    expect(desktopExecutor.getDevice()).toBeNull()
    expect(sim.requests).not.toContain('GET /api/desktop/inbox')
    expect(sim.requests).not.toContain('GET /api/desktop/inbox/stream')
  })

  it('offers no binding to a Sim that speaks another protocol version', async () => {
    const { sim, desktopExecutor } = await service(2)
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))

    sim.registrations[0]?.(true)
    await sleep(100)

    expect(desktopExecutor.getDevice()).toBeNull()
    expect(sim.requests.filter((request) => request.includes('/api/desktop/inbox'))).toEqual([])
  })

  it('stays dormant while Sim has the executor off: no inbox and no doorbell', async () => {
    const { sim, desktopExecutor } = await service()
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))

    sim.registrations[0]?.(false)
    await sleep(100)

    expect(desktopExecutor.getDevice()).toBeNull()
    expect(sim.requests.filter((request) => request.includes('/api/desktop/inbox'))).toEqual([])
  })

  it('stays dormant against a Sim without the executor routes, checking back only slowly', async () => {
    const { sim, desktopExecutor } = await service()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      desktopExecutor.start()
      await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))

      sim.registrations[0]?.(404)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(sim.registrations).toHaveLength(1)
      expect(sim.requests.filter((request) => request.includes('/api/desktop/inbox'))).toEqual([])

      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect(sim.registrations).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers again as soon as the network returns, not after its backoff', async () => {
    const { sim, desktopExecutor } = await service()
    vi.mocked(net.isOnline).mockReturnValue(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      desktopExecutor.start()
      // Four failures with no network leave the next attempt at least 12.8 s away.
      for (let failure = 0; failure < 4; failure += 1) {
        await vi.waitFor(() => expect(sim.registrations).toHaveLength(failure + 1))
        sim.registrations[failure]?.('offline')
        await vi.advanceTimersByTimeAsync(failure < 3 ? 10_000 : 0)
      }
      expect(sim.registrations).toHaveLength(4)

      vi.mocked(net.isOnline).mockReturnValue(true)
      await vi.advanceTimersByTimeAsync(2_500)

      expect(sim.registrations).toHaveLength(5)
    } finally {
      vi.useRealTimers()
      vi.mocked(net.isOnline).mockReturnValue(true)
    }
  })

  it('registers with no install id it could not save', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sim-executor-service-'))
    await chmod(userData, 0o500)
    try {
      const { sim, desktopExecutor } = await service(1, userData)

      desktopExecutor.start()
      await sleep(200)

      expect(sim.requests.filter((request) => request.includes('/api/desktop/devices'))).toEqual([])
    } finally {
      await chmod(userData, 0o700)
    }
  })

  it('keeps its install id through a read failure instead of minting a new one', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'sim-executor-service-'))
    // A path that exists but cannot be read as a file: not "no id yet".
    await mkdir(join(userData, 'desktop-executor-device.json'))
    const { sim, desktopExecutor } = await service(1, userData)

    desktopExecutor.start()
    await sleep(200)

    expect(sim.requests.filter((request) => request.includes('/api/desktop/devices'))).toEqual([])
  })

  it('releases the sleep blocker at sign-out while a call is still running', async () => {
    const { sim, desktopExecutor, busy } = await service()
    sim.offered.push('call-1')
    desktopExecutor.start()
    await vi.waitFor(() => expect(sim.registrations).toHaveLength(1))
    sim.registrations[0]?.(true)
    await vi.waitFor(() => expect(busy).toEqual([true]))

    await desktopExecutor.signOut()

    expect(busy).toEqual([true, false])
  })
})

describe('device name', () => {
  it('fits a long hostname within what Sim accepts at registration', () => {
    expect(deviceName(`${'studio-'.repeat(40)}.local`).length).toBeLessThanOrEqual(128)
    expect(deviceName('Studio-Mac.local')).toBe('Studio-Mac')
  })
})
