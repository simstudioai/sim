/**
 * @vitest-environment node
 *
 * Guards the one Attio site that interpolates a parameter into the request
 * *query* zone: `attio_assert_record`'s `matching_attribute`.
 *
 * `matchingAttribute` is `required: true, visibility: 'user-or-llm'`, so
 * prompt injection controls it. Interpolated raw, a value carrying `&` appends
 * arbitrary extra query parameters to the request, and a value carrying `#`
 * truncates the URL at a fragment — both while the caller's Attio OAuth token
 * is still attached.
 *
 * Every assertion resolves the built URL through `new URL(...)` — the same
 * parse `fetch` performs — and inspects `searchParams`, never the raw string.
 * A `.includes()` assertion on the template is exactly the weak form that lets
 * a broken rewrite pass.
 */
import { describe, expect, it } from 'vitest'
import { attioAssertRecordTool } from '@/tools/attio/assert_record'

const ORIGIN = 'https://api.attio.com'
const PATHNAME = '/v2/objects/people/records'

function buildUrl(matchingAttribute: unknown): URL {
  return new URL(
    (attioAssertRecordTool.request!.url as (p: any) => string)({
      accessToken: 'token',
      objectType: 'people',
      matchingAttribute,
      values: '{}',
    })
  )
}

/** Values a real caller supplies; each must survive verbatim. */
const LEGITIMATE = [
  'email_addresses',
  'domains',
  'custom.attr-1',
  'attr+plus',
  'attr with space',
  '97052eb9-e65e-443f-a297-f2d9a4a7f795',
] as const

/** Vectors that reshape the request when interpolated raw. */
const INJECTIONS = [
  'email_addresses&limit=1&x=y',
  'a#b',
  'email_addresses#',
  'x&matching_attribute=y',
  'a=b&c=d',
] as const

describe('attio_assert_record matching_attribute query safety', () => {
  it('builds the expected origin and path', () => {
    const url = buildUrl('email_addresses')
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe(PATHNAME)
  })

  it.each(LEGITIMATE)('round-trips %j verbatim', (value) => {
    const url = buildUrl(value)
    expect(url.searchParams.get('matching_attribute')).toBe(value)
    expect([...url.searchParams.keys()]).toEqual(['matching_attribute'])
  })

  it.each(INJECTIONS)('confines %j to the matching_attribute value', (value) => {
    const url = buildUrl(value)

    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe(PATHNAME)
    expect(url.hash).toBe('')
    expect([...url.searchParams.keys()]).toEqual(['matching_attribute'])
    expect(url.searchParams.get('matching_attribute')).toBe(value)
  })

  /**
   * The realistic slug shapes — word characters, `_`, `-`, `.`, and a UUID —
   * are all `application/x-www-form-urlencoded`-safe, so `URLSearchParams`
   * emits exactly the bytes raw interpolation did. A value containing a
   * literal space or `+` does change on the wire (` ` becomes `+`, `+`
   * becomes `%2B`), which is the *correct* form-urlencoded spelling and the
   * only spelling that round-trips: raw interpolation sent `+` literally,
   * which any form-urlencoded decoder reads back as a space.
   */
  it.each(['email_addresses', 'domains', 'custom.attr-1', '97052eb9-e65e-443f-a297-f2d9a4a7f795'])(
    'emits byte-identical wire bytes for %j',
    (value) => {
      const raw = (attioAssertRecordTool.request!.url as (p: any) => string)({
        accessToken: 'token',
        objectType: 'people',
        matchingAttribute: value,
        values: '{}',
      })
      expect(raw).toBe(`${ORIGIN}${PATHNAME}?matching_attribute=${value}`)
    }
  )

  it('still trims surrounding whitespace', () => {
    expect(buildUrl('  email_addresses  ').searchParams.get('matching_attribute')).toBe(
      'email_addresses'
    )
  })

  it('stringifies a numeric value instead of throwing a TypeError', () => {
    expect(buildUrl(123).searchParams.get('matching_attribute')).toBe('123')
  })

  it.each([null, undefined, '', '   '])('rejects %j by name', (value) => {
    expect(() => buildUrl(value)).toThrow(/matchingAttribute/)
  })
})
