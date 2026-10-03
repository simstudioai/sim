import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextSession, readTelemetryState, type TelemetryState, writeTelemetryState } from './state'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-telemetry-'))
  path = join(dir, 'telemetry.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('telemetry state', () => {
  it('round-trips through the file, readable by the owner only', () => {
    const state: TelemetryState = {
      version: 1,
      deviceId: 'device-1',
      enabled: false,
      noticeShownAt: '2026-09-10T00:00:00.000Z',
      session: { id: 'session-1', lastActiveAt: '2026-09-10T00:00:00.000Z', sequence: 3 },
    }

    writeTelemetryState(state, path)

    expect(readTelemetryState(path)).toEqual(state)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })

  it('drops a malformed session or notice stamp but keeps the device id', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        deviceId: 'device-1',
        noticeShownAt: 'yesterday',
        session: { id: 'session-1', lastActiveAt: 'never', sequence: -1 },
      })
    )

    expect(readTelemetryState(path)).toEqual({ version: 1, deviceId: 'device-1' })
  })
})

describe('nextSession', () => {
  const state: TelemetryState = { version: 1, deviceId: 'device-1' }
  const now = new Date('2026-09-10T12:00:00.000Z')

  it('starts a new session when the clock has moved backwards', () => {
    const future = new Date(now.getTime() + 60_000)
    const session = nextSession(
      { ...state, session: { id: 'session-1', lastActiveAt: future.toISOString(), sequence: 4 } },
      now
    )

    expect(session.id).not.toBe('session-1')
  })
})
