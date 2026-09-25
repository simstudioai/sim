import { describe, expect, it } from 'vitest'
import {
  attributeUndeclaredClient,
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

  it('returns undefined for an empty, missing, or oversized value', () => {
    expect(parseClientInfo('')).toBeUndefined()
    expect(parseClientInfo(null)).toBeUndefined()
    expect(parseClientInfo(undefined)).toBeUndefined()
    expect(parseClientInfo(`cli/1.0.0; ${'x'.repeat(300)}/1`)).toBeUndefined()
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

  it('leaves a credentialed browser request to be attributed by its credential', () => {
    expect(
      resolveClientInfo(
        headers({
          'sec-fetch-mode': 'cors',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        }),
        { hasExternalCredentials: true }
      )
    ).toEqual({ surface: 'unknown', source: 'unidentified', name: 'browser' })
  })
})

describe('attributeUndeclaredClient', () => {
  const _undeclared = { surface: 'unknown', source: 'unidentified', name: 'curl' } as const

  it('never changes a client that identified itself or a trigger that started a run', () => {
    const cli = { surface: 'cli', version: '2.1.2', source: 'header' } as const
    const web = { surface: 'web', source: 'fetch_metadata' } as const
    const schedule = { surface: 'schedule', source: 'trigger' } as const
    expect(attributeUndeclaredClient(cli, 'personal_api_key')).toBe(cli)
    expect(attributeUndeclaredClient(web, 'session')).toBe(web)
    expect(attributeUndeclaredClient(schedule, 'system')).toBe(schedule)
  })
})
