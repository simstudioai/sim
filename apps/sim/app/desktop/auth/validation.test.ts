/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildDesktopAuthPath,
  buildLoopbackUrl,
  isValidHandoffState,
  parseLoopbackPort,
} from '@/app/desktop/auth/validation'

describe('isValidHandoffState', () => {
  it('accepts URL-safe high-entropy states', () => {
    expect(isValidHandoffState('a'.repeat(32))).toBe(true)
    expect(isValidHandoffState('Ab0_-'.repeat(4))).toBe(true)
  })

  it('rejects short, oversized, malformed, and non-string values', () => {
    expect(isValidHandoffState('a'.repeat(15))).toBe(false)
    expect(isValidHandoffState('a'.repeat(257))).toBe(false)
    expect(isValidHandoffState('bad state!'.repeat(3))).toBe(false)
    expect(isValidHandoffState(undefined)).toBe(false)
    expect(isValidHandoffState(42)).toBe(false)
  })
})

describe('parseLoopbackPort', () => {
  it('accepts non-privileged ports', () => {
    expect(parseLoopbackPort('1024')).toBe(1024)
    expect(parseLoopbackPort('54321')).toBe(54321)
    expect(parseLoopbackPort('65535')).toBe(65535)
  })

  it('rejects privileged, out-of-range, and malformed ports', () => {
    expect(parseLoopbackPort('80')).toBeNull()
    expect(parseLoopbackPort('65536')).toBeNull()
    expect(parseLoopbackPort('-1')).toBeNull()
    expect(parseLoopbackPort('12a4')).toBeNull()
    expect(parseLoopbackPort('')).toBeNull()
    expect(parseLoopbackPort(undefined)).toBeNull()
  })
})

describe('URL builders', () => {
  const state = 's'.repeat(32)

  it('rebuilds the landing path from validated params only', () => {
    expect(buildDesktopAuthPath(state, 54321)).toBe(`/desktop/auth?state=${state}&port=54321`)
    expect(buildDesktopAuthPath(state, null)).toBe(`/desktop/auth?state=${state}`)
  })

  it('builds the loopback callback URL on the 127.0.0.1 IP literal', () => {
    expect(buildLoopbackUrl('tok123456', state, 54321)).toBe(
      `http://127.0.0.1:54321/auth/callback?token=tok123456&state=${state}`
    )
  })
})
