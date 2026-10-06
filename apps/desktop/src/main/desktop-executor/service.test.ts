import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { createDesktopExecutorService, deviceName } from '@/main/desktop-executor/service'

/** Sim's device routes, with registration answers held until the test releases them. */
function fakeSim(protocolVersion = 1) {
  const requests: string[] = []
  const registrations: Array<(enabled: boolean) => void> = []
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname
    requests.push(`${init.method} ${path}`)
    if (path === '/api/desktop/devices') {
      const enabled = await new Promise<boolean>((resolve) => registrations.push(resolve))
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

async function service(protocolVersion = 1) {
  const sim = fakeSim(protocolVersion)
  const desktopExecutor = createDesktopExecutorService({
    userDataPath: await mkdtemp(join(tmpdir(), 'sim-executor-service-')),
    origin: () => 'https://sim.test',
    appSession: () => ({ fetch: sim.fetch }) as unknown as Session,
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
    await vi.waitFor(() => expect(sim.requests).toContain('GET /api/desktop/inbox'))

    expect(desktopExecutor.getDevice()).toBeNull()
  })
})

describe('device name', () => {
  it('fits a long hostname within what Sim accepts at registration', () => {
    expect(deviceName(`${'studio-'.repeat(40)}.local`).length).toBeLessThanOrEqual(128)
    expect(deviceName('Studio-Mac.local')).toBe('Studio-Mac')
  })
})
