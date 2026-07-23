import { describe, expect, it } from 'vitest'
import { compareVersions, isShellOutdated } from '@/lib/desktop/min-version'

describe('compareVersions', () => {
  it('orders release cores numerically', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('v0.5.24', '0.5.24')).toBe(0)
  })

  it('ranks prereleases below their release', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3-rc.9')).toBe(1)
  })

  it('compares prerelease identifiers per semver', () => {
    expect(compareVersions('1.4.0-beta.2', '1.4.0-beta.10')).toBe(-1)
    expect(compareVersions('1.4.0-rc.1', '1.4.0-beta.9')).toBe(1)
    expect(compareVersions('1.4.0-beta.2', '1.4.0-beta.2')).toBe(0)
    expect(compareVersions('1.4.0-alpha', '1.4.0-alpha.1')).toBe(-1)
  })

  it('returns null for unparseable input', () => {
    expect(compareVersions('nightly', '1.2.3')).toBeNull()
    expect(compareVersions('1.2', '1.2.3')).toBeNull()
  })
})

describe('isShellOutdated', () => {
  it('never gates while the floor is 0.0.0', () => {
    expect(isShellOutdated(undefined, '0.0.0')).toBe(false)
    expect(isShellOutdated('0.0.1', '0.0.0')).toBe(false)
    expect(isShellOutdated('garbage', '0.0.0')).toBe(false)
  })

  it('gates shells below the floor and accepts the floor and newer', () => {
    expect(isShellOutdated('0.2.9', '0.3.0')).toBe(true)
    expect(isShellOutdated('0.3.0', '0.3.0')).toBe(false)
    expect(isShellOutdated('0.4.0', '0.3.0')).toBe(false)
  })

  it('treats a prerelease of the floor as below it', () => {
    expect(isShellOutdated('0.3.0-beta.2', '0.3.0')).toBe(true)
  })

  it('fails closed for missing or unparseable shell versions once a floor is set', () => {
    expect(isShellOutdated(undefined, '0.3.0')).toBe(true)
    expect(isShellOutdated('nightly', '0.3.0')).toBe(true)
  })
})
