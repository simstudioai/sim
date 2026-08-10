/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getResolvedSecretMatchPolicy,
  isNonIdentifyingSecretLiteral,
  isWordBoundaryMatch,
  MIN_UNANCHORED_MATCH_LENGTH,
} from '@/executor/utils/resolved-secret-match-policy'

describe('getResolvedSecretMatchPolicy', () => {
  it.each(['test', 'Test', '483920', 'hunter2', 'F', ''])(
    'restricts short value %s to boundary matches',
    (value) => {
      expect(value.length).toBeLessThan(MIN_UNANCHORED_MATCH_LENGTH)
      expect(getResolvedSecretMatchPolicy(value)).toBe('boundary')
    }
  )

  it.each([
    ['32-char hex', '5f4dcc3b5aa765d61d8327deb882cf99'],
    ['base64 key', 'sk-proj-Ab3xK9mQ2pLw7nRt5vYc8Zd4'],
    ['github pat', 'ghp_16C7e42F292c6912E7710c838347Ae178B4a'],
    ['slack bot token', 'xoxb-2334-4567-abcdefGHIJKL'],
    ['9-digit value', '123456789'],
    ['8-char password', 'Passw0rd'],
  ])('allows unanchored matching for a %s', (_label, value) => {
    expect(getResolvedSecretMatchPolicy(value)).toBe('anywhere')
  })

  /**
   * Every one of these scores below 3.0 bits/char; an entropy floor would have demoted them.
   * Prefixed shapes are assembled at runtime so the source carries no literal that reads as a
   * live credential to a secret scanner.
   */
  it.each([
    ['all-f HMAC key', 'f'.repeat(32)],
    ['test PAN', '4111111111111111'],
    ['padded AWS key id', `AKIA${'0'.repeat(16)}`],
    ['repeated-block hex', 'deadbeefdeadbeefdeadbeefdeadbeef'],
    ['padded stripe-style key', `sk_live_${'0'.repeat(24)}`],
    ['padded PAT', `ghp_${'a'.repeat(36)}`],
  ])('keeps unanchored matching for a low-variety full-length %s', (_label, value) => {
    expect(getResolvedSecretMatchPolicy(value)).toBe('anywhere')
  })
})

describe('isWordBoundaryMatch', () => {
  it.each([
    ['test', 0, 4, true],
    ['key=test', 4, 8, true],
    ['"test"', 1, 5, true],
    ['{"k":"test"}', 6, 10, true],
    ['test ok', 0, 4, true],
    ['latest', 2, 6, false],
    ['tested', 0, 4, false],
    ['prefixtest', 6, 10, false],
  ])('anchors %s at [%i,%i) => %s', (value, start, end, expected) => {
    expect(isWordBoundaryMatch(value, start, end)).toBe(expected)
  })

  it.each([
    ['user_test_id', 5, 9],
    ['sk_live_test', 8, 12],
    ['test_suffix', 0, 4],
  ])('anchors %s across an underscore, the dominant identifier joiner', (value, start, end) => {
    expect(isWordBoundaryMatch(value, start, end)).toBe(true)
  })

  it('treats non-ASCII letters as word characters', () => {
    expect(isWordBoundaryMatch('прtestка', 2, 6)).toBe(false)
  })

  it('treats astral-plane letters as word characters', () => {
    expect(isWordBoundaryMatch('\u{1D400}test\u{1D401}', 2, 6)).toBe(false)
    expect(isWordBoundaryMatch('x\u{20000}test\u{20000}y', 3, 7)).toBe(false)
  })

  it('keeps a combining mark attached to the word it decorates', () => {
    expect(isWordBoundaryMatch('test́ing', 0, 4)).toBe(false)
  })

  it('anchors a match whose own edge characters are not word characters', () => {
    expect(isWordBoundaryMatch('a!!!!b', 1, 5)).toBe(true)
  })

  it('reads an out-of-range probe as a non-word character rather than a match', () => {
    expect(isWordBoundaryMatch('abc', 0, 3)).toBe(true)
    expect(isWordBoundaryMatch('abc', 3, 3)).toBe(true)
  })
})

describe('isNonIdentifyingSecretLiteral', () => {
  it.each(['true', 'false', 'null'])(
    'excludes %s, whose value space is too small to identify',
    (literal) => {
      expect(isNonIdentifyingSecretLiteral(literal)).toBe(true)
    }
  )

  it.each(['0', '1', 'False', 'TRUE', 'Null', 'nullish', '', 'hunter2', 'sk_live_abc'])(
    'keeps %s protectable',
    (literal) => {
      expect(isNonIdentifyingSecretLiteral(literal)).toBe(false)
    }
  )
})
