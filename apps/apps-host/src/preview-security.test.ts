import { describe, expect, it } from 'bun:test'
import {
  appDirectoryRedirect,
  isPublishedDocumentRequest,
  isValidPreviewChannelNonce,
  normalizePreviewParentOrigin,
  safeJsonForScript,
  ttlLruGet,
  ttlLruSet,
} from './preview-security'

describe('preview security helpers', () => {
  it('safely serializes script data', () => {
    const serialized = safeJsonForScript({ value: '</script>\u2028' })
    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script>')
    expect(serialized).toContain('\\u2028')
  })

  it('normalizes parent origins and rejects non-http protocols', () => {
    expect(normalizePreviewParentOrigin('https://sim.example/path?q=1')).toBe('https://sim.example')
    expect(normalizePreviewParentOrigin('javascript:alert(1)')).toBeNull()
  })

  it('requires a strong preview capability', () => {
    expect(isValidPreviewChannelNonce('a'.repeat(32))).toBe(true)
    expect(isValidPreviewChannelNonce('short')).toBe(false)
    expect(isValidPreviewChannelNonce('<script>'.repeat(5))).toBe(false)
  })

  it('redirects only bare app documents and preserves query strings', () => {
    expect(
      appDirectoryRedirect('https://apps.example', '/a/public-id/my-app', '?ref=test', undefined)
    ).toBe('https://apps.example/a/public-id/my-app/?ref=test')
    expect(appDirectoryRedirect('https://apps.example', '/a/public-id/my-app/', '', '')).toBeNull()
    expect(
      appDirectoryRedirect(
        'https://apps.example',
        '/a/public-id/my-app/assets/app.js',
        '',
        'assets/app.js'
      )
    ).toBeNull()
  })

  it('bounds TTL LRU maps', () => {
    const cache = new Map<string, { fetchedAt: number; value: string }>()
    ttlLruSet(cache, 'first', { fetchedAt: Date.now(), value: '1' }, 2)
    ttlLruSet(cache, 'second', { fetchedAt: Date.now(), value: '2' }, 2)
    expect(ttlLruGet(cache, 'first', 1_000)?.value).toBe('1')
    ttlLruSet(cache, 'third', { fetchedAt: Date.now(), value: '3' }, 2)
    expect(cache.has('second')).toBe(false)
    expect(cache.size).toBe(2)
  })

  it('revalidates release metadata for document requests but not hashed assets', () => {
    expect(isPublishedDocumentRequest('', 'text/html')).toBe(true)
    expect(isPublishedDocumentRequest('settings', 'text/html')).toBe(true)
    expect(isPublishedDocumentRequest('index.html', 'text/html')).toBe(true)
    expect(isPublishedDocumentRequest('assets/app.abc123.js', '*/*')).toBe(false)
  })
})

describe('safeJsonForScript', () => {
  it('blocks </script> breakout via query-style payload', () => {
    const injected = safeJsonForScript({
      channelNonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      parentOrigin: 'https://evil.test/</script><script>alert(1)</script>',
    })
    expect(injected.includes('</script>')).toBe(false)
    expect(injected.includes('\\u003c')).toBe(true)
  })
})

describe('normalizePreviewParentOrigin', () => {
  it('returns precise origin only', () => {
    expect(normalizePreviewParentOrigin('https://sim.localhost:3000/workspace/x')).toBe(
      'https://sim.localhost:3000'
    )
    expect(normalizePreviewParentOrigin('javascript:alert(1)')).toBeNull()
    expect(normalizePreviewParentOrigin('not a url')).toBeNull()
  })
})

describe('isValidPreviewChannelNonce', () => {
  it('rejects short and injectable nonces', () => {
    expect(isValidPreviewChannelNonce('aaaaaaaa')).toBe(false)
    expect(isValidPreviewChannelNonce('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(isValidPreviewChannelNonce('x"</script><script>')).toBe(false)
  })
})

describe('ttlLru', () => {
  it('evicts oldest entries past max size', () => {
    const map = new Map<string, { fetchedAt: number; n: number }>()
    for (let i = 0; i < 5; i++) {
      ttlLruSet(map, `k${i}`, { fetchedAt: Date.now(), n: i }, 3)
    }
    expect(map.size).toBe(3)
    expect(map.has('k0')).toBe(false)
    expect(map.has('k1')).toBe(false)
    expect(map.has('k2')).toBe(true)
    expect(map.has('k4')).toBe(true)
  })

  it('drops expired entries on get', () => {
    const map = new Map<string, { fetchedAt: number }>()
    map.set('a', { fetchedAt: Date.now() - 10_000 })
    expect(ttlLruGet(map, 'a', 5_000)).toBeUndefined()
    expect(map.has('a')).toBe(false)
  })
})
