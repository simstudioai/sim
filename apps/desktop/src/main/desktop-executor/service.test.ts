import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { createDesktopExecutorService, deviceName } from '@/main/desktop-executor/service'

/** Sim's device routes, with registration answers held until the test releases them. */
function fakeSim(protocolVersion = 1) {
  const requests: string[] = []
  /** Answers to pending registrations: enabled or not, or an HTTP status Sim fails with. */
  const registrations: Array<(answer: boolean | number) => void> = []
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname
    requests.push(`${init.method} ${path}`)
    if (path === '/api/desktop/devices') {
      const answer = await new Promise<boolean | number>((resolve) => registrations.push(resolve))
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
    if (path === '/api/desktop/inbox') return Response.json({ items: [] })
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    )
  })
  return { fetch, requests, registrations }
}

async function service(protocolVersion = 1, userDataPath?: string) {
  const sim = fakeSim(protocolVersion)
  const desktopExecutor = createDesktopExecutorService({
    userDataPath: userDataPath ?? (await mkdtemp(join(tmpdir(), 'sim-executor-service-'))),
    origin: () => 'https://sim.test',
    appSession: () => ({ fetch: sim.fetch }),
    preferences: () => ({ browserEnabled: true, terminalEnabled: true }),
    accountDataAvailable: () => true,
    runner: { run: vi.fn(), cancel: vi.fn() },
  })
  return { sim, desktopExecutor }
}

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
})

describe('device name', () => {
  it('fits a long hostname within what Sim accepts at registration', () => {
    expect(deviceName(`${'studio-'.repeat(40)}.local`).length).toBeLessThanOrEqual(128)
    expect(deviceName('Studio-Mac.local')).toBe('Studio-Mac')
  })
})
