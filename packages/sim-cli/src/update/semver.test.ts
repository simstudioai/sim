/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { channelOf, compareVersions, parseVersion } from './semver'

function parsed(version: string) {
  const result = parseVersion(version)
  if (!result) throw new Error(`fixture "${version}" should parse`)
  return result
}

function order(left: string, right: string): number {
  return Math.sign(compareVersions(parsed(left), parsed(right)))
}

describe('parsing a published version', () => {
  it('reads the release triple', () => {
    expect(parseVersion('2.1.5')).toEqual({ major: 2, minor: 1, patch: 5, prerelease: [] })
  })

  it('splits a prerelease into identifiers, keeping numeric ones numeric', () => {
    expect(parseVersion('2.1.3-preview.812.1')?.prerelease).toEqual(['preview', 812, 1])
  })

  it('ignores build metadata, which carries no precedence', () => {
    expect(parseVersion('2.1.5+20260902')).toEqual(parseVersion('2.1.5'))
  })

  it.each([
    ['2.1', 'an incomplete triple'],
    ['v2.1.2', 'a leading v, which npm does not publish'],
    ['2.1.2.3', 'a fourth component'],
    ['01.2.3', 'a leading zero'],
    ['2.1.2-', 'an empty prerelease'],
    ['2.1.2-preview..1', 'an empty identifier'],
    ['', 'nothing at all'],
    ['latest', 'a dist-tag mistaken for a version'],
  ])('rejects %s (%s)', (version) => {
    expect(parseVersion(version)).toBeNull()
  })

  it('rejects a component too large to compare exactly', () => {
    expect(parseVersion('9007199254740993.0.0')).toBeNull()
  })
})

describe('precedence', () => {
  it('orders the release triple before anything else', () => {
    expect(order('2.1.2', '2.1.3')).toBe(-1)
    expect(order('2.1.9', '2.2.0')).toBe(-1)
    expect(order('2.9.9', '3.0.0')).toBe(-1)
    expect(order('2.1.5', '2.1.5')).toBe(0)
  })

  it('ranks a prerelease below the release it leads to', () => {
    expect(order('2.1.3-preview.44.1', '2.1.3')).toBe(-1)
  })

  it('ranks a release above a prerelease of the same triple', () => {
    // The mirror of the case above, and a distinct branch: it is the only way
    // to reach the comparison with an empty prerelease list on the left.
    expect(order('2.1.3', '2.1.3-preview.44.1')).toBe(1)
  })

  it('orders two alphanumeric identifiers by ASCII', () => {
    expect(order('2.1.3-alpha', '2.1.3-beta')).toBe(-1)
    expect(order('2.1.3-beta', '2.1.3-alpha')).toBe(1)
  })

  it('compares numeric identifiers as numbers, not as text', () => {
    // The case a string comparison gets backwards: run 9 precedes run 44, but
    // "44" sorts before "9" lexicographically.
    expect(order('2.1.3-preview.9.1', '2.1.3-preview.44.1')).toBe(-1)
  })

  it('ranks a numeric identifier below an alphanumeric one', () => {
    expect(order('2.1.3-1', '2.1.3-alpha')).toBe(-1)
    expect(order('2.1.3-alpha', '2.1.3-1')).toBe(1)
  })

  it('ranks a shorter identifier list below a longer one sharing its prefix', () => {
    expect(order('2.1.3-preview.1', '2.1.3-preview.1.2')).toBe(-1)
  })

  it('ranks a stable release below a prerelease of a later patch', () => {
    // 2.1.2 really is older than 2.1.3-preview.44.1. The guarantee that this
    // never reaches a user as "upgrade" lives in check.ts, which returns before
    // comparing anything on a non-stable channel — see check.test.ts's "says
    // nothing to a prerelease install".
    expect(order('2.1.2', '2.1.3-preview.44.1')).toBe(-1)
  })
})

describe('the channel a version was published under', () => {
  it('reads a stable release as the latest tag', () => {
    expect(channelOf(parsed('2.1.5'))).toBe('latest')
  })

  it('reads the two prerelease tags the publish workflow produces', () => {
    expect(channelOf(parsed('2.1.6-preview.812.1'))).toBe('staging')
    expect(channelOf(parsed('2.1.6-dev.812.1'))).toBe('dev')
  })

  it('refuses to guess a channel for a prerelease tag we do not publish', () => {
    expect(channelOf(parsed('2.1.6-rc.1'))).toBeNull()
  })
})
