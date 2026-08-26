/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { encodeStoragePath, encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'

describe('supabaseBaseUrl', () => {
  it.concurrent('should return the correct URL for a valid project ID', () => {
    const url = supabaseBaseUrl('jdrkgepadsdopsntdlom')
    expect(url).toBe('https://jdrkgepadsdopsntdlom.supabase.co')
  })

  it.concurrent('should throw on fragment injection attempt', () => {
    expect(() => supabaseBaseUrl('evil#attacker.com')).toThrow()
  })

  it.concurrent('should throw on empty string', () => {
    expect(() => supabaseBaseUrl('')).toThrow()
  })

  it.concurrent('should throw on path traversal', () => {
    expect(() => supabaseBaseUrl('evil/../../etc')).toThrow()
  })

  it.concurrent('should throw on authority injection', () => {
    expect(() => supabaseBaseUrl('evil@attacker.com')).toThrow()
  })

  it.concurrent('should throw on uppercase letters', () => {
    expect(() => supabaseBaseUrl('ABCDEFGHIJKLMNOPQRST')).toThrow()
  })

  it.concurrent('should throw on too-short IDs', () => {
    expect(() => supabaseBaseUrl('abc')).toThrow()
  })
})

describe('encodeStorageSegment', () => {
  it.concurrent.each(['..', '.', '  ..  ', 'a/../../b', '\\..\\..', ''])('rejects %j', (value) => {
    expect(() => encodeStorageSegment(value)).toThrow(/bucket/)
  })

  it.concurrent('preserves a legitimate bucket name', () => {
    const url = new URL(
      `${supabaseBaseUrl('jdrkgepadsdopsntdlom')}/storage/v1/bucket/${encodeStorageSegment('my-bucket.v2')}`
    )
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(5)
    expect(segments[1]).toBe('storage')
    expect(segments[4]).toBe('my-bucket.v2')
  })
})

describe('encodeStoragePath', () => {
  it.concurrent.each(['..', '.', 'a/../b', '\\..\\..', ''])('rejects %j', (value) => {
    expect(() => encodeStoragePath(value)).toThrow(/path/)
  })

  /**
   * Supabase Storage's server-side key allowlist
   * (`/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/`, `src/storage/limits.ts`) permits
   * `/` freely, so `//`, a leading `/`, and a trailing `/` are all legal,
   * addressable object keys — and the WHATWG URL parser preserves every one of
   * them verbatim (only an *exact* `.` or `..` segment is removed). Rejecting
   * them made real objects unreachable.
   */
  it.concurrent.each([
    ['a//b', '/o/bkt/a//b'],
    ['/leading', '/o/bkt//leading'],
    ['trailing/', '/o/bkt/trailing/'],
    ['a//b//c', '/o/bkt/a//b//c'],
  ] as const)('accepts the legal storage key %j and addresses %j', (value, expectedPath) => {
    const url = new URL(`https://x/o/bkt/${encodeStoragePath(value)}`)

    expect(url.pathname).toBe(expectedPath)
  })

  /**
   * The server never trims a key and a literal space is inside the allowlist,
   * so `' report.csv'` is a distinct object from `'report.csv'`. Trimming it
   * silently addressed a different object with no error.
   */
  it.concurrent.each([' report.csv', 'report.csv ', ' a/b.csv ', ' '] as const)(
    'preserves outer whitespace in %j',
    (value) => {
      const url = new URL(`https://x/o/bkt/${encodeStoragePath(value)}`)

      expect(
        url.pathname.slice('/o/bkt/'.length).split('/').map(decodeURIComponent).join('/')
      ).toBe(value)
    }
  )

  it.concurrent('still rejects a dot segment even with empty segments allowed', () => {
    expect(() => encodeStoragePath('a//../b')).toThrow(/path/)
    expect(() => encodeStoragePath('/..')).toThrow(/path/)
    expect(() => encodeStoragePath('../')).toThrow(/path/)
  })

  it.concurrent('keeps the number coercion the shared helper provides', () => {
    expect(encodeStoragePath(12345 as unknown as string)).toBe('12345')
    expect(() => encodeStoragePath(null as unknown as string)).toThrow(/path is required/)
  })

  it.concurrent('cannot pop a segment off the fixed storage prefix', () => {
    const base = supabaseBaseUrl('jdrkgepadsdopsntdlom')

    expect(() => encodeStoragePath('../..')).toThrow()

    const url = new URL(
      `${base}/storage/v1/object/public/my-bucket/${encodeStoragePath('folder/file.jpg')}`
    )
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(8)
    expect(segments[1]).toBe('storage')
    expect(segments[2]).toBe('v1')
    expect(segments[3]).toBe('object')
    expect(segments[4]).toBe('public')
    expect(segments[5]).toBe('my-bucket')
    expect(segments.slice(6).join('/')).toBe('folder/file.jpg')
  })

  it.concurrent('escapes a query-injection attempt into a literal name', () => {
    const url = new URL(
      `${supabaseBaseUrl('jdrkgepadsdopsntdlom')}/storage/v1/object/b/${encodeStoragePath('x?foo=attacker')}`
    )

    expect(url.searchParams.get('foo')).toBeNull()
    expect(url.pathname.split('/')).toHaveLength(6)
  })
})
