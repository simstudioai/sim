import { describe, expect, it } from 'vitest'
import {
  figmaFileKey,
  figmaNodeIds,
  figmaOptionalBoolean,
  figmaOptionalNumber,
  figmaVersionCursor,
} from '@/tools/figma/utils'

describe('Figma resource locators', () => {
  it.each(['design', 'file', 'proto', 'board', 'slides'])(
    'extracts a file key from a %s URL without fetching it',
    (kind) => {
      expect(
        figmaFileKey(` https://www.figma.com/${kind}/testFileKey/Example?node-id=12-34 `)
      ).toBe('testFileKey')
    }
  )
  it.each([
    'https://example.com/design/key/name',
    'https://www.figma.com.evil.test/design/key/name',
    'https://user:password@www.figma.com/design/key/name',
    '..',
    '.',
    '',
    'https://www.figma.com/design/',
  ])('rejects an unsafe or missing file locator: %s', (value) => {
    expect(() => figmaFileKey(value)).toThrow()
  })
  it('preserves a raw key and colon node IDs while normalizing copied numeric node IDs', () => {
    expect(figmaFileKey(' testFileKey ')).toBe('testFileKey')
    expect(figmaNodeIds(' 12:34, 56-78 ')).toBe('12:34,56:78')
  })
  it.each(['', ' , ', '12:34,,56:78'])('rejects an empty node list entry: %j', (value) => {
    expect(() => figmaNodeIds(value)).toThrow()
  })
  it('bounds node-list length and cardinality before normalizing resolved input', () => {
    expect(() => figmaNodeIds('1'.repeat(64 * 1024 + 1))).toThrow('64 Ki characters')
    expect(() => figmaNodeIds(Array.from({ length: 1001 }, () => '12:34').join(','))).toThrow(
      '1000 node IDs'
    )
  })
  it('rejects URL-encoded invalid file keys before requesting a resource', () => {
    expect(() => figmaFileKey('https://www.figma.com/design/a%2Fb/Title')).toThrow()
    expect(() => figmaFileKey('https://www.figma.com/design/key%20with%20spaces/Title')).toThrow()
  })

  it('keeps large version cursors exact instead of converting them to floating point', () => {
    expect(figmaVersionCursor(' 12345678901234567890 ')).toBe('12345678901234567890')
    expect(() => figmaVersionCursor(Number('12345678901234567890'))).toThrow()
  })
})

describe('Figma control inputs', () => {
  it.each([false, 'false'])('retains an explicit false rendering option: %j', (value) => {
    expect(figmaOptionalBoolean(value, 'contentsOnly')).toBe(false)
  })
  it.each([true, 'true'])('retains an explicit true option: %j', (value) => {
    expect(figmaOptionalBoolean(value, 'branchData')).toBe(true)
  })
  it.each(['false-ish', 1, {}])('rejects a non-boolean option: %j', (value) => {
    expect(() => figmaOptionalBoolean(value, 'contentsOnly')).toThrow()
  })
  it('retains the smallest supported export scale and rejects out-of-range/infinite numbers', () => {
    expect(figmaOptionalNumber('0.01', 'scale', { min: 0.01, max: 4 })).toBe(0.01)
    for (const value of [0, 4.1, Number.POSITIVE_INFINITY, 'NaN'])
      expect(() => figmaOptionalNumber(value, 'scale', { min: 0.01, max: 4 })).toThrow()
    expect(() => figmaOptionalNumber('1.5', 'depth', { min: 1, integer: true })).toThrow()
  })
})
