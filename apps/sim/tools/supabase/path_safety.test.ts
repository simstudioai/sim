/**
 * @vitest-environment node
 *
 * Guards every Supabase tool against path traversal through an LLM-writable
 * value interpolated into the request path.
 *
 * The headline defect is `encodeStoragePath`, which **read as sanitisation and
 * was a no-op for traversal**: it split the object key on `/` and ran
 * `encodeURIComponent` over each piece, but `.` and `..` are unreserved, so
 * `'../..'` came back byte-for-byte unchanged. The URL parser then removed
 * those dot segments after decoding, walking the request — with the workspace's
 * Supabase **service-role key** attached — out of `/storage/v1/object/` and
 * into any other API prefix on the same host, including on DELETE.
 *
 * A storage key legitimately contains `/`, so the fix could not be
 * `safeUrlPathSegment`: it is `safeUrlPath`, which keeps the separator
 * and rejects only the dot segments.
 *
 * **The assertions below pin exact encoded output and exact error text on
 * purpose.** `safeUrlPath` lives in `tools/url-path.ts`, owned by #7262, which
 * this branch is rebased onto — so its behaviour changes land underneath this
 * file. Twice now that is precisely how a change was caught: segment trimming
 * being dropped, and the empty-segment check narrowing from `!segment.trim()`
 * to `!segment`. Rewriting these into `toThrow()` would have let both through
 * silently.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
} from '@/tools/__tests__/path-safety'
import * as supabaseTools from '@/tools/supabase/index'
import { encodeStoragePath, encodeStorageSegment } from '@/tools/supabase/utils'

const PROJECT_ID = 'jdrkgepadsdopsntdlom'
const ORIGIN = `https://${PROJECT_ID}.supabase.co`

/** Every Supabase route this integration calls lives under one of these. */
const BASE_PATH = '/'

/** `projectId` is `user-only` and already SSRF-guarded, so it is pinned. */
const FIXED = { projectId: PROJECT_ID, apiKey: 'service-role-key' }

/**
 * Flat values shared by every non-storage tool. Kept to the SQL-identifier
 * alphabet because `table` and `column` are separately validated by
 * `validateDatabaseIdentifier`, which legitimately refuses `-` and `.`.
 */
const LEGITIMATE_FLAT = ['avatars', 'user_uploads', 'documents'] as const

/** Hierarchical values: a storage object key legitimately carries `/`. */
const LEGITIMATE_KEYS = [
  'file.png',
  'folder/sub/file.png',
  'invoices/2024/q1/report.pdf',
  'my.file.name.txt',
  'folder/my file .png',
] as const

/**
 * Every tool contributing no path parameter, pinned exactly so none can leave
 * coverage unnoticed. Each entry is one of: a static or query-string-only URL,
 * a `url` declared as a constant string, or an `InternalToolConfig` whose URL is
 * built in `lib/internal/**` and is therefore out of this suite's reach.
 */
const STATIC_URL_TOOLS = [
  'supabase_introspect',
  'supabase_storage_copy',
  'supabase_storage_create_bucket',
  'supabase_storage_get_public_url',
  'supabase_storage_list_buckets',
  'supabase_storage_move',
  'supabase_storage_update_bucket',
  'supabase_storage_upload',
]

const {
  covered: PATH_PARAMS,
  unbuildable: UNBUILDABLE,
  undiscoverable: UNDISCOVERABLE,
  withoutPathParams: WITHOUT_PATH_PARAMS,
} = discoverPathParams(supabaseTools, 'supabase_', FIXED)

/**
 * `path` is the only genuinely hierarchical parameter here, so it is the only
 * one fed multi-segment object keys. Every other path parameter is flat, and
 * `table` / `column` are separately validated by `validateDatabaseIdentifier`,
 * which legitimately refuses `-` and `.`.
 */
const KEY_PARAMS = PATH_PARAMS.filter(({ paramName }) => paramName === 'path')
const FLAT_PARAMS = PATH_PARAMS.filter(({ paramName }) => paramName !== 'path')

describe('supabase path traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('probes every declared parameter without one silently dropping out', () => {
    expect(UNDISCOVERABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(WITHOUT_PATH_PARAMS).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(21)
  })

  /**
   * Both derived groups are pinned, not just their total.
   *
   * `describe.each` over an empty array emits **no tests and no failure**, so
   * if `path` were renamed, `KEY_PARAMS` would silently empty and the entire
   * "legitimate object keys" block — the assertions proving
   * `folder/sub/file.png` survives byte-for-byte — would disappear while the
   * total above still passed. A floor on the sum cannot see a shift between the
   * two groups.
   */
  it('keeps both parameter groups non-empty', () => {
    expect(KEY_PARAMS.length).toBeGreaterThanOrEqual(3)
    expect(FLAT_PARAMS.length).toBeGreaterThanOrEqual(18)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, {
      origin: ORIGIN,
      basePath: BASE_PATH,
      /**
       * `table` and `functionName` are refused by `validateDatabaseIdentifier`
       * and `validateFunctionName`, which predate these guards and legitimately
       * reject values the shared guards only render inert.
       */
      strictlyValidated: ['table', 'functionName'],
    })
  })

  describe.each(FLAT_PARAMS)('$label legitimate values', (param) => {
    itPassesLegitimateValues(param, { values: LEGITIMATE_FLAT, fixed: FIXED })
  })

  describe.each(KEY_PARAMS)('$label legitimate object keys', (param) => {
    itPassesLegitimateValues(param, {
      values: LEGITIMATE_KEYS,
      fixed: { ...FIXED, bucket: 'avatars' },
    })
  })
})

describe('encodeStoragePath', () => {
  it('returned a traversal payload byte-for-byte unchanged before the fix', () => {
    expect(
      '../..'
        .split('/')
        .map((segment) => encodeURIComponent(segment.trim()))
        .join('/')
    ).toBe('../..')
  })

  it.each(['..', '../..', 'a/../../b', 'bucket/../../rest/v1/secrets', 'a/./b'])(
    'rejects %j',
    (value) => {
      expect(() => encodeStoragePath(value, 'path')).toThrow(/traversal/i)
    }
  )

  it('rejects a backslash', () => {
    expect(() => encodeStoragePath('a\\..\\b', 'path')).toThrow(/backslash/)
  })

  it.each(LEGITIMATE_KEYS)('keeps the separators and content of %j', (value) => {
    expect(decodeURIComponent(encodeStoragePath(value, 'path'))).toBe(value)
  })

  it('still escapes reserved characters inside a segment', () => {
    expect(encodeStoragePath('my folder/a?b#c.png', 'path')).toBe('my%20folder/a%3Fb%23c.png')
  })

  it('resolves inside the storage prefix even under attack', () => {
    expect(() => encodeStoragePath('../../rest/v1/secrets', 'path')).toThrow()
    expect(
      new URL(`${ORIGIN}/storage/v1/object/b/${encodeStoragePath('a/b.png', 'path')}`).pathname
    ).toBe('/storage/v1/object/b/a/b.png')
  })
})

describe('encodeStorageSegment', () => {
  it.each(['..', '.', '  ..  '])('rejects the dot segment %j', (value) => {
    expect(() => encodeStorageSegment(value, 'bucket')).toThrow(/traversal/i)
  })

  it('rejects a separator in a flat bucket name', () => {
    expect(() => encodeStorageSegment('bucket/nested', 'bucket')).toThrow(/separator/)
  })

  it.each(['avatars', 'user_uploads', 'public-assets'])('passes %j through', (value) => {
    expect(encodeStorageSegment(value, 'bucket')).toBe(value)
  })
})

/**
 * `safeUrlPath` restores `:` after percent-encoding, for GitHub's cross-fork
 * ref syntax. These assertions confirm that is inert for a Supabase key rather
 * than assuming it: the server decodes the path before resolving the object, so
 * a literal `:` and a `%3A` name the same key, and a leading `:` cannot be read
 * as a URL scheme because the value is always joined onto an absolute base.
 */
describe('colon handling inherited from safeUrlPath', () => {
  it('addresses the same object whether the colon is encoded or literal', () => {
    const literal = new URL(`${ORIGIN}/storage/v1/object/avatars/${encodeStoragePath('a:b.png')}`)
    const encoded = new URL(`${ORIGIN}/storage/v1/object/avatars/${encodeURIComponent('a:b.png')}`)

    expect(decodeURIComponent(literal.pathname)).toBe(decodeURIComponent(encoded.pathname))
  })

  it('keeps a leading colon inside the storage prefix', () => {
    const url = new URL(`${ORIGIN}/storage/v1/object/avatars/${encodeStoragePath(':odd/x.png')}`)

    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe('/storage/v1/object/avatars/:odd/x.png')
  })
})

/**
 * `safeUrlPath` rejects empty segments where the old helper silently emitted
 * them. That is a tightening, and these assertions pin why it is correct: the
 * emitted path addressed a *different* object than the caller wrote.
 */
describe('empty segments in a storage key', () => {
  it.each(['/folder/x.png', 'folder//x.png', 'folder/x.png/'])('rejects %j', (value) => {
    expect(() => encodeStoragePath(value)).toThrow(/empty path segment/)
  })

  /**
   * A **whitespace-only** component is permitted, and that is not the same rule.
   *
   * `safeUrlPath` originally rejected `!segment.trim()`, which lumped `a/ /b` in
   * with `a//b`. #7262 narrowed it to `!segment` after this suite flagged the
   * over-rejection, and the distinction is exactly right for an object key: a
   * component that is a single space is a legal, nameable key component, while a
   * genuinely empty one addresses a *different* object than the caller wrote.
   *
   * Both halves are pinned here, because collapsing them again in either
   * direction is a silent correctness change — one direction makes a real key
   * unreachable, the other silently retargets the request.
   */
  it.each(['a/ /b', 'a/  /b', 'folder/ /file.png'])(
    'permits the whitespace-only component in %j',
    (value) => {
      expect(decodeURIComponent(encodeStoragePath(value))).toBe(value)
    }
  )

  it('keeps a whitespace-only component distinct from an empty one', () => {
    expect(encodeStoragePath('a/ /b')).toBe('a/%20/b')
    expect(() => encodeStoragePath('a//b')).toThrow(/empty path segment/)
  })

  it('would otherwise have addressed a different object', () => {
    const doubled = new URL(`${ORIGIN}/storage/v1/object/avatars//folder/x.png`)
    const single = new URL(`${ORIGIN}/storage/v1/object/avatars/folder/x.png`)

    expect(doubled.pathname).not.toBe(single.pathname)
  })
})

/**
 * Whitespace handling for a storage object key: **the whole value is trimmed,
 * the inside is preserved.**
 *
 * These are different in kind and the split is deliberate.
 *
 * Edge padding on the whole value is a paste artifact and never part of the
 * key. The helper this replaced trimmed it, so a saved workflow whose key field
 * carried a stray space resolved fine; preserving it turned that into a 404.
 * That is the one place in this PR where something that worked before would
 * have stopped working, so the trim is restored.
 *
 * Whitespace *inside* the key is genuine data — `avatars/ photo.png` names a
 * component that starts with a space — and is preserved, which is the
 * correctness `safeUrlPath` exists to provide.
 */
describe('whitespace in a storage object key', () => {
  it('trims edge padding on the whole value, as the previous helper did', () => {
    expect(decodeURIComponent(encodeStoragePath('  avatars/photo.png  '))).toBe('avatars/photo.png')
  })

  /**
   * The exact regression this restores: a pasted key with a stray space
   * resolved before and must resolve now.
   */
  it('resolves a pasted key to the same object it resolved to before', () => {
    const pasted = new URL(
      `${ORIGIN}/storage/v1/object/avatars/${encodeStoragePath('  folder/report.pdf  ')}`
    )
    const clean = new URL(
      `${ORIGIN}/storage/v1/object/avatars/${encodeStoragePath('folder/report.pdf')}`
    )

    expect(pasted.pathname).toBe(clean.pathname)
  })

  it.each(['avatars/ photo.png', 'a/ /b', 'folder/my file .png', 'a b/c d.png'])(
    'preserves whitespace inside %j',
    (value) => {
      expect(decodeURIComponent(encodeStoragePath(value))).toBe(value)
    }
  )

  it('keeps a whitespace-only component distinct from an empty one', () => {
    expect(encodeStoragePath('a/ /b')).toBe('a/%20/b')
    expect(() => encodeStoragePath('a//b')).toThrow(/empty path segment/)
  })

  /**
   * Trimming the whole value exposes a padded dot segment rather than encoding
   * it, which is strictly safer than before: `"  ..  "` used to survive as
   * `%20%20..%20%20`, and is now refused outright.
   */
  it('refuses a padded dot segment once the value is trimmed', () => {
    expect(() => encodeStoragePath('  ..  ')).toThrow(/traversal is not allowed/)
    expect(() => encodeStoragePath('..')).toThrow(/traversal is not allowed/)
  })
})

/**
 * The premise behind trimming rather than refusing: **no destructive storage
 * operation routes an object key through `encodeStoragePath`.**
 *
 * Elsewhere this branch refuses a padded identifier, because on a
 * state-changing request trimming turns a 404 into a real mutation. That does
 * not apply here — but only because of a fact about where these keys travel,
 * which could change silently. Pinned so it cannot.
 */
describe('no destructive storage operation puts its key through the path guard', () => {
  it('storage_delete sends keys in the body, not the path', () => {
    const params = {
      projectId: PROJECT_ID,
      apiKey: 'k',
      bucket: 'avatars',
      paths: ['  folder/report.pdf  '],
    }
    const url = new URL(
      (supabaseTools.supabaseStorageDeleteTool.request?.url as (p: typeof params) => string)(params)
    )
    const body = (
      supabaseTools.supabaseStorageDeleteTool.request?.body as (p: typeof params) => unknown
    )(params)

    expect(url.pathname).toBe('/storage/v1/object/avatars')
    expect(url.pathname).not.toContain('report.pdf')
    expect(body).toEqual({ prefixes: ['  folder/report.pdf  '] })
  })

  it.each([
    ['supabase_storage_move', 'supabaseStorageMoveTool'],
    ['supabase_storage_copy', 'supabaseStorageCopyTool'],
  ] as const)('%s sends keys in the body, not the path', (_name, exportName) => {
    const tool = (supabaseTools as Record<string, unknown>)[exportName] as {
      request: { url: (p: Record<string, unknown>) => string }
    }
    const url = new URL(
      tool.request.url({
        projectId: PROJECT_ID,
        apiKey: 'k',
        bucket: 'avatars',
        fromPath: 'a.png',
        toPath: 'b.png',
      })
    )

    expect(url.pathname).not.toContain('a.png')
    expect(url.pathname).not.toContain('b.png')
  })
})
