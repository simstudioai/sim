import { describe, expect, it } from 'vitest'
import { findNativeProviderFetches, mayLoadTransport } from './check-egress-boundary'

describe('egress transport candidate scan', () => {
  it('finds literal transport modules', () => {
    expect(mayLoadTransport("import { request } from 'node:https'")).toBe(true)
  })

  it('decodes escaped transport module literals', () => {
    expect(mayLoadTransport(String.raw`const http = require('node:\x68ttp')`)).toBe(true)
  })

  it('ignores transport names outside string tokens', () => {
    expect(mayLoadTransport('const https = createClient()')).toBe(false)
  })
})

describe('organization-aware provider fetch boundary', () => {
  it('detects native calls and explicit global bypasses', () => {
    expect(
      findNativeProviderFetches('fetch(url)\nglobalThis.fetch(url)\nglobal.fetch(url)')
    ).toEqual([1, 2, 3])
  })
  it('leaves routed calls, client methods, strings and comments alone', () => {
    expect(
      findNativeProviderFetches(
        "secureFetchWithValidation(url, options); client.fetch(url); const text = 'fetch(url)'; /* fetch(url) */"
      )
    ).toEqual([])
  })

  it('detects native fetch passed to SDKs or saved under another name', () => {
    expect(
      findNativeProviderFetches(
        [
          'new Client({ fetch })',
          'new Client({ fetch: globalThis.fetch })',
          'const send = fetch',
          "const sendGlobal = globalThis['fetch']",
          'const { fetch: unguarded } = globalThis',
        ].join('\n')
      )
    ).toEqual([1, 2, 3, 4, 5])
  })

  it('allows fetch types, guarded SDK options and object method declarations', () => {
    expect(
      findNativeProviderFetches(
        [
          'type Fetcher = typeof fetch',
          'const client = new Client({ fetch: transport.fetch })',
          'const { fetch: guarded } = transport',
          'const object = { fetch(url: string) { return transport.fetch(url) } }',
        ].join('\n')
      )
    ).toEqual([])
  })

  it('exempts only named account lifecycle entry points in their exact modules', () => {
    const source = [
      'export function revokeQuickBooksToken() { fetch(url) }',
      'export function refreshToken() { fetch(url) }',
      'fetch(url)',
    ].join('\n')
    expect(findNativeProviderFetches(source, 'apps/sim/lib/oauth/quickbooks.ts')).toEqual([2, 3])
    expect(findNativeProviderFetches(source, 'apps/sim/lib/oauth/other.ts')).toEqual([1, 2, 3])
  })

  it('uses the top-level entry point for nested helpers and callbacks', () => {
    const source = [
      'export function createGitHubRepositoriesProvider() {',
      '  return { getToken: () => fetch(url) }',
      '}',
      'export function runtimeProvider() {',
      '  function createGitHubRepositoriesProvider() { globalThis.fetch(url) }',
      '}',
    ].join('\n')
    expect(findNativeProviderFetches(source, 'apps/sim/lib/oauth/github-repositories.ts')).toEqual([
      5,
    ])
  })
})
