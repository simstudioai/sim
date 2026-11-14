import { describe, expect, it } from 'vitest'
import { findDirectFetches } from './check-organization-egress'

const lines = (source: string) => findDirectFetches('file.ts', source).map((hit) => hit.line)

describe('organization egress scan', () => {
  it('reports the global fetch and globalThis.fetch', () => {
    expect(
      lines(`const a = await fetch(url)
const b = await globalThis.fetch(url)`)
    ).toEqual([1, 2])
  })

  it('reports an alias, a fallback, a shorthand property and another global object', () => {
    expect(
      lines(`const f = fetch
const g = custom ?? fetch
new OpenAI({ fetch })
function run(transport = fetch) {}
await window.fetch(url)
await self['fetch'](url)`)
    ).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('ignores fetch in type positions and as a property key', () => {
    expect(
      lines(`type Fetch = typeof fetch
const transport: typeof globalThis.fetch = outboundFetch
new Anthropic({ fetch: outboundFetch })`)
    ).toEqual([])
  })

  it('ignores a client method or a local binding named fetch', () => {
    expect(
      lines(`class Client { async fetch(path: string) { return this.fetch(path) } }
await client.fetch(url)
async function run(fetch: typeof globalThis.fetch) { return fetch(url) }`)
    ).toEqual([])
  })

  it('reports a fetch imported from anywhere but the outbound router, at its import', () => {
    expect(
      lines(`import { fetch } from 'undici'
await fetch(url)
import nodeFetch, { fetch as undiciFetch } from 'undici'
import fetch from 'node-fetch'`)
    ).toEqual([1, 3, 4])
  })

  it('accepts outboundFetch imported under the name fetch', () => {
    expect(
      lines(`import { outboundFetch as fetch } from '@/lib/core/network/outbound-fetch.server'
await fetch(url)`)
    ).toEqual([])
  })

  it('accepts an egress-direct annotation within two lines above the call', () => {
    expect(
      lines(`// egress-direct: operator-local Ollama server
const a = await fetch(url, {
})
// egress-direct: public catalog

const b = await fetch(url)

const c = 1
const d = await fetch(url)`)
    ).toEqual([9])
  })

  it('ignores fetch named in strings and comments', () => {
    expect(lines(`const description = 'fetch() is available'\n// call fetch(url) here`)).toEqual([])
  })
})
