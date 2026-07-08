/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildBaseUrl } from '@/connectors/zendesk/zendesk'

describe('buildBaseUrl', () => {
  it.concurrent('builds the base URL for a valid subdomain', () => {
    expect(buildBaseUrl('acme')).toBe('https://acme.zendesk.com')
  })

  it.concurrent('allows hyphens and digits within the label', () => {
    expect(buildBaseUrl('acme-support-1')).toBe('https://acme-support-1.zendesk.com')
  })

  it.concurrent('allows a single-character subdomain', () => {
    expect(buildBaseUrl('a')).toBe('https://a.zendesk.com')
  })

  it.concurrent('allows the maximum 63-character label', () => {
    const label = `a${'b'.repeat(61)}c`
    expect(label).toHaveLength(63)
    expect(buildBaseUrl(label)).toBe(`https://${label}.zendesk.com`)
  })

  it.concurrent('trims surrounding whitespace', () => {
    expect(buildBaseUrl('  acme  ')).toBe('https://acme.zendesk.com')
  })

  it.concurrent('normalizes uppercase to lowercase (DNS is case-insensitive)', () => {
    expect(buildBaseUrl('MyCompany')).toBe('https://mycompany.zendesk.com')
  })

  describe('rejects SSRF payloads', () => {
    const ssrfPayloads: Array<[string, string]> = [
      ['fragment truncation', 'webhook.site/abc#'],
      ['fragment with path', 'evil.com/path#'],
      ['embedded path', 'acme/api/v2'],
      ['scheme injection', 'http://evil.com'],
      ['userinfo', 'user@evil.com'],
      ['port', 'acme:8080'],
      ['open-redirect host', 'httpbin.org/redirect-to?url=http://169.254.169.254'],
      ['loopback', '127.0.0.1'],
      ['link-local literal', '169.254.169.254'],
      ['whitespace injection', 'acme evil'],
      ['leading hyphen', '-acme'],
      ['trailing hyphen', 'acme-'],
      ['leading dot', '.acme'],
      ['trailing dot', 'acme.'],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['over-length label', 'a'.repeat(64)],
      ['unicode', 'acmé'],
    ]

    it.concurrent.each(ssrfPayloads)('rejects %s', (_label, payload) => {
      expect(() => buildBaseUrl(payload)).toThrow('Invalid Zendesk subdomain')
    })
  })
})
