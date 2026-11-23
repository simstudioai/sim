import { beforeEach, describe, expect, it, vi } from 'vitest'

const { world, mockSpawnSync, mockDocker, mockConfirm } = vi.hoisted(() => ({
  /** Whether the managed container is up; it publishes 127.0.0.1:6379. */
  world: { running: false },
  mockSpawnSync: vi.fn(),
  mockDocker: vi.fn(),
  mockConfirm: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: mockSpawnSync }
})

vi.mock('./db', () => ({ docker: mockDocker }))

vi.mock('./docker', () => ({ ensureDocker: vi.fn(async () => true) }))

vi.mock('./probes', () => ({
  redisPing: vi.fn(async (url: string) =>
    world.running && new URL(url).host === '127.0.0.1:6379'
      ? { ok: true }
      : { ok: false, error: 'ECONNREFUSED' }
  ),
  waitFor: async (probe: () => Promise<boolean>) => probe(),
}))

vi.mock('./prompter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./prompter')>()
  return {
    ...actual,
    confirm: mockConfirm,
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    log: { step: vi.fn(), warn: vi.fn(), info: vi.fn() },
  }
})

import type { Detection } from './detect'
import { ensureRedis, resolveRedis } from './redis'

const CONFIGURED = 'redis://127.0.0.1:6379/5'

function detection(state: 'running' | 'stopped'): Detection {
  return {
    redisPortOpen: false,
    redisContainer: { state, managed: true },
  } as Detection
}

describe('reusing the managed Redis container', () => {
  beforeEach(() => {
    world.running = false
    mockConfirm.mockReset()
    mockDocker.mockImplementation((args: string[]) => {
      if (args[0] === 'start') world.running = true
    })
    mockSpawnSync.mockImplementation((command: string, args: string[]) =>
      command === 'docker' && args[0] === 'port'
        ? { status: 0, stdout: '127.0.0.1:6379\n', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
  })

  it('keeps the configured DB index when quick mode restarts a stopped container', async () => {
    await expect(ensureRedis(detection('stopped'), CONFIGURED)).resolves.toBe(CONFIGURED)
    expect(mockDocker).toHaveBeenCalledWith(['start', 'sim-redis'])
  })

  it('keeps the configured DB index when custom mode restarts a stopped container', async () => {
    await expect(resolveRedis(detection('stopped'), CONFIGURED)).resolves.toBe(CONFIGURED)
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('does not restore a configured URL the user declined to keep', async () => {
    world.running = true
    mockConfirm.mockResolvedValue(false)

    await expect(resolveRedis(detection('running'), CONFIGURED)).resolves.toBe(
      'redis://127.0.0.1:6379'
    )
  })
})
