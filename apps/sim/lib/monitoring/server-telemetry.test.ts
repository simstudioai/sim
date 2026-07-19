/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  isRemoteTelemetryEndpoint,
  resolveTelemetryEndpoint,
} from '@/lib/monitoring/server-telemetry'

describe('server telemetry helpers', () => {
  it('detects remote telemetry endpoints', () => {
    expect(isRemoteTelemetryEndpoint(DEFAULT_TELEMETRY_ENDPOINT)).toBe(true)
    expect(isRemoteTelemetryEndpoint('http://localhost:4318/v1/traces')).toBe(false)
  })

  it('resolves explicit telemetry endpoint from env', () => {
    const previous = process.env.TELEMETRY_ENDPOINT
    process.env.TELEMETRY_ENDPOINT = 'http://localhost:4318/v1/traces'
    expect(resolveTelemetryEndpoint()).toBe('http://localhost:4318/v1/traces')
    if (previous === undefined) {
      process.env.TELEMETRY_ENDPOINT = undefined
    } else {
      process.env.TELEMETRY_ENDPOINT = previous
    }
  })
})
