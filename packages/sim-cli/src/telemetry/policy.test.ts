import { describe, expect, it } from 'vitest'
import { telemetryStatus } from './policy'

describe('telemetryStatus', () => {
  it.each(['1', 'true', 'TRUE', 'yes'])('honours DO_NOT_TRACK=%s before anything else', (value) => {
    expect(
      telemetryStatus({ env: { DO_NOT_TRACK: value }, state: { enabled: true }, configured: true })
    ).toEqual({ enabled: false, reason: 'do_not_track' })
  })

  it('names the environment switch ahead of the saved setting', () => {
    expect(
      telemetryStatus({
        env: { SIM_TELEMETRY_DISABLED: '1' },
        state: { enabled: false },
        configured: true,
      })
    ).toEqual({ enabled: false, reason: 'environment' })
  })
})
