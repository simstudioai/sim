import { describe, expect, it } from 'vitest'
import { isLoopbackHostname } from './hostnames'

describe('isLoopbackHostname', () => {
  it('does not match other loopback-range IPs or public hosts (exact-set only)', () => {
    expect(isLoopbackHostname('127.0.0.5')).toBe(false)
    expect(isLoopbackHostname('example.com')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
  })
})
