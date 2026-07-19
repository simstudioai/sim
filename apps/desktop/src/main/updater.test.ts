import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { isDowngrade, parseSemver, resolveUpdateChannel } from '@/main/updater'

describe('resolveUpdateChannel', () => {
  it('maps stable versions to latest', () => {
    expect(resolveUpdateChannel('1.2.3')).toBe('latest')
    expect(resolveUpdateChannel('0.5.24')).toBe('latest')
  })

  it('maps prerelease versions to their channel', () => {
    expect(resolveUpdateChannel('1.2.3-beta.1')).toBe('beta')
    expect(resolveUpdateChannel('1.2.3-alpha.2')).toBe('alpha')
  })
})

describe('parseSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' })
    expect(parseSemver('v0.5.24')).toEqual({ major: 0, minor: 5, patch: 24, prerelease: '' })
    expect(parseSemver('1.2.3-beta.1')?.prerelease).toBe('beta.1')
  })

  it('returns null for garbage', () => {
    expect(parseSemver('latest')).toBeNull()
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('')).toBeNull()
  })
})

describe('isDowngrade', () => {
  it('rejects lower versions', () => {
    expect(isDowngrade('1.2.3', '1.2.2')).toBe(true)
    expect(isDowngrade('1.2.3', '1.1.9')).toBe(true)
    expect(isDowngrade('2.0.0', '1.9.9')).toBe(true)
  })

  it('accepts equal and higher versions', () => {
    expect(isDowngrade('1.2.3', '1.2.3')).toBe(false)
    expect(isDowngrade('1.2.3', '1.2.4')).toBe(false)
    expect(isDowngrade('1.2.3', '2.0.0')).toBe(false)
  })

  it('treats a prerelease of the current stable core as a downgrade', () => {
    expect(isDowngrade('1.2.3', '1.2.3-beta.1')).toBe(true)
    expect(isDowngrade('1.2.3-beta.1', '1.2.3')).toBe(false)
  })

  it('compares prerelease identifiers within the same core version', () => {
    expect(isDowngrade('1.4.0-beta.5', '1.4.0-beta.2')).toBe(true)
    expect(isDowngrade('1.4.0-beta.2', '1.4.0-beta.10')).toBe(false)
    expect(isDowngrade('1.4.0-beta.2', '1.4.0-beta.2')).toBe(false)
    expect(isDowngrade('1.4.0-rc.1', '1.4.0-beta.9')).toBe(true)
  })

  it('treats unparseable versions as downgrades', () => {
    expect(isDowngrade('1.2.3', 'nightly')).toBe(true)
    expect(isDowngrade('garbage', '1.2.3')).toBe(true)
  })
})
