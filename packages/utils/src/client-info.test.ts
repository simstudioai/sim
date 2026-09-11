import { describe, expect, it } from 'vitest'
import {
  CLIENT_INFO_HEADER,
  formatClientInfo,
  parseClientInfo,
  resolveClientInfo,
} from './client-info'

function headers(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

describe('formatClientInfo', () => {
  it('renders every field as a product token in a fixed order', () => {
    expect(
      formatClientInfo({
        surface: 'cli',
        version: '2.1.2',
        runtime: { name: 'node', version: '22.14.0' },
        os: 'darwin',
        arch: 'arm64',
        agent: 'claude-code',
      })
    ).toBe('cli/2.1.2; node/22.14.0; os/darwin; arch/arm64; agent/claude-code')
  })

  it('renders an unversioned surface as a bare token', () => {
    expect(formatClientInfo({ surface: 'web' })).toBe('web')
  })

  it('refuses a value that is not an RFC 9110 token', () => {
    expect(() => formatClientInfo({ surface: 'cli', version: '2.1.2 beta' })).toThrow(
      /not a valid token/
    )
  })
})

describe('parseClientInfo', () => {
  it('round-trips a formatted value', () => {
    const info = {
      surface: 'desktop' as const,
      version: '1.4.2',
      runtime: { name: 'electron', version: '43.5.0' },
      os: 'darwin',
      arch: 'arm64',
    }
    expect(parseClientInfo(formatClientInfo(info))).toEqual(info)
  })

  it('accepts trailing tokens in any order', () => {
    expect(parseClientInfo('cli/2.1.2; agent/codex; arch/x64; node/20.0.0; os/linux')).toEqual({
      surface: 'cli',
      version: '2.1.2',
      runtime: { name: 'node', version: '20.0.0' },
      os: 'linux',
      arch: 'x64',
      agent: 'codex',
    })
  })

  it('returns undefined for an unknown surface', () => {
    expect(parseClientInfo('curl/8.0.0')).toBeUndefined()
  })

  it('returns undefined for an empty, missing, or oversized value', () => {
    expect(parseClientInfo('')).toBeUndefined()
    expect(parseClientInfo(null)).toBeUndefined()
    expect(parseClientInfo(undefined)).toBeUndefined()
    expect(parseClientInfo(`cli/1.0.0; ${'x'.repeat(300)}/1`)).toBeUndefined()
  })

  it('skips malformed and unknown trailing tokens instead of failing', () => {
    expect(parseClientInfo('cli/2.1.2; ; not a token; future/thing; os/darwin')).toEqual({
      surface: 'cli',
      version: '2.1.2',
      runtime: { name: 'future', version: 'thing' },
      os: 'darwin',
    })
  })

  it('carries any well-formed agent token through', () => {
    expect(parseClientInfo('cli/2.1.2; agent/some-new-agent')?.agent).toBe('some-new-agent')
  })

  it('keeps the first of a repeated token', () => {
    expect(parseClientInfo('cli/2.1.2; os/darwin; os/linux')?.os).toBe('darwin')
  })
})

describe('resolveClientInfo', () => {
  it('prefers a declared header over every other signal', () => {
    const resolved = resolveClientInfo(
      headers({
        [CLIENT_INFO_HEADER]: 'cli/2.1.2; node/22.0.0',
        'user-agent': 'Mozilla/5.0',
        'sec-fetch-mode': 'cors',
      }),
      { hasExternalCredentials: true }
    )
    expect(resolved).toEqual({
      surface: 'cli',
      version: '2.1.2',
      runtime: { name: 'node', version: '22.0.0' },
      source: 'header',
    })
  })

  it('recognises the user agent of CLI releases that predate the header', () => {
    const resolved = resolveClientInfo(
      headers({ 'user-agent': 'sim-cli/2.0.9 node/22.14.0 (darwin; arm64)' }),
      { hasExternalCredentials: true }
    )
    expect(resolved).toEqual({ surface: 'cli', version: '2.0.9', source: 'user_agent' })
  })

  it('infers the web app from fetch metadata on an uncredentialed browser request', () => {
    const resolved = resolveClientInfo(headers({ 'sec-fetch-mode': 'cors' }), {
      hasExternalCredentials: false,
    })
    expect(resolved).toEqual({ surface: 'web', source: 'fetch_metadata' })
  })

  it('leaves a credentialed browser request unattributed', () => {
    expect(
      resolveClientInfo(headers({ 'sec-fetch-mode': 'cors' }), { hasExternalCredentials: true })
    ).toBeUndefined()
  })

  it('leaves a bare request unattributed', () => {
    expect(
      resolveClientInfo(headers({ 'user-agent': 'curl/8.0.0' }), { hasExternalCredentials: true })
    ).toBeUndefined()
  })
})
