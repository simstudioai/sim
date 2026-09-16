import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CaptureRequest,
  DEFAULT_INGEST_HOST,
  type SpawnSender,
  sendCapture,
} from './transport'

const request: CaptureRequest = {
  api_key: 'phc_test',
  event: 'cli_command_executed',
  distinct_id: 'device-1',
  timestamp: '2026-09-10T12:00:00.000Z',
  properties: { command: 'workflows list' },
}

function fakeSpawn() {
  const child = { unref: vi.fn(), once: vi.fn() }
  const spawn = vi.fn<SpawnSender>(() => child)
  return { spawn, child }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sendCapture', () => {
  it('hands the event to a detached sender and lets go of it', () => {
    const { spawn, child } = fakeSpawn()

    sendCapture({ key: 'phc_test', host: DEFAULT_INGEST_HOST }, request, spawn)

    expect(spawn).toHaveBeenCalledOnce()
    const [command, args, options] = spawn.mock.calls[0]
    expect(command).toBe(process.execPath)
    expect(args).toContain('--input-type=module')
    expect(options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true })
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('addresses the capture endpoint on the target host and carries the event in the environment', () => {
    const { spawn } = fakeSpawn()

    sendCapture({ key: 'phc_test', host: 'https://eu.i.posthog.com' }, request, spawn)

    const payload = JSON.parse(spawn.mock.calls[0][2].env.SIM_TELEMETRY_CAPTURE as string)
    expect(payload.url).toBe('https://eu.i.posthog.com/i/v0/e/')
    expect(JSON.parse(payload.body)).toEqual(request)
    expect(payload.timeoutMs).toBeGreaterThan(0)
  })

  it('never hands the sender the API key', () => {
    vi.stubEnv('SIM_API_KEY', 'sim_secret')
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.internal:3128')
    const { spawn } = fakeSpawn()

    sendCapture({ key: 'phc_test', host: DEFAULT_INGEST_HOST }, request, spawn)

    const env = spawn.mock.calls[0][2].env
    expect(env.SIM_API_KEY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBe('http://proxy.internal:3128')
  })

  it('swallows a sender that cannot start', () => {
    const spawn = vi.fn<SpawnSender>(() => {
      throw new Error('spawn EAGAIN')
    })

    expect(() =>
      sendCapture({ key: 'phc_test', host: DEFAULT_INGEST_HOST }, request, spawn)
    ).not.toThrow()
  })
})
