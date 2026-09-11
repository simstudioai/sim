import { describe, expect, it } from 'vitest'
import { telemetryStatus } from './policy'

describe('telemetryStatus', () => {
  it('is on when nothing turns it off and the build can report', () => {
    expect(telemetryStatus({ env: {}, state: {}, configured: true })).toEqual({ enabled: true })
  })

  it.each(['1', 'true', 'TRUE', 'yes'])('honours DO_NOT_TRACK=%s before anything else', (value) => {
    expect(
      telemetryStatus({ env: { DO_NOT_TRACK: value }, state: { enabled: true }, configured: true })
    ).toEqual({ enabled: false, reason: 'do_not_track' })
  })

  it.each(['0', 'false', ''])('ignores DO_NOT_TRACK=%s', (value) => {
    expect(telemetryStatus({ env: { DO_NOT_TRACK: value }, state: {}, configured: true })).toEqual({
      enabled: true,
    })
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

  it('names the saved setting ahead of a missing destination', () => {
    expect(telemetryStatus({ env: {}, state: { enabled: false }, configured: false })).toEqual({
      enabled: false,
      reason: 'setting',
    })
  })

  it('is off in a build with no destination', () => {
    expect(telemetryStatus({ env: {}, state: {}, configured: false })).toEqual({
      enabled: false,
      reason: 'unconfigured',
    })
  })
})
