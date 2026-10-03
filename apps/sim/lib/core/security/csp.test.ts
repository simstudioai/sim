import { afterEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { setEnv } = await import('@sim/testing/mocks/env.mock')
  setEnv({
    NEXT_PUBLIC_APP_URL: 'https://example.com',
    NEXT_PUBLIC_SOCKET_URL: 'https://socket.example.com',
    OLLAMA_URL: 'http://localhost:11434',
    S3_BUCKET_NAME: 'test-bucket',
    AWS_REGION: 'us-east-1',
    S3_KB_BUCKET_NAME: 'test-kb-bucket',
    S3_CHAT_BUCKET_NAME: 'test-chat-bucket',
    NEXT_PUBLIC_BRAND_LOGO_URL: 'https://brand.example.com/logo.png',
    NEXT_PUBLIC_BRAND_FAVICON_URL: 'https://brand.example.com/favicon.ico',
    NEXT_PUBLIC_PRIVACY_URL: 'https://legal.example.com/privacy',
    NEXT_PUBLIC_TERMS_URL: 'https://legal.example.com/terms',
    S3_ENDPOINT: 'https://s3.de.io.cloud.ovh.net',
    S3_FORCE_PATH_STYLE: undefined,
  })
})

import { setEnv } from '@sim/testing/mocks/env.mock'
import { buildCSPString, generateRuntimeCSP, getChatEmbedCSPPolicy, getMainCSPPolicy } from './csp'

describe('buildCSPString', () => {
  it('drops empty directives and blank sources', () => {
    const result = buildCSPString({
      'default-src': ["'self'", '', '  ', 'https://example.com'],
      'script-src': [],
    })

    expect(result).toContain("default-src 'self' https://example.com")
    expect(result).not.toContain('script-src')
    expect(result).not.toMatch(/\s{2,}/)
  })
})

function connectSources(policy: string): string[] {
  const directive = policy.split('; ').find((d) => d.startsWith('connect-src ')) ?? ''
  return directive.split(' ').slice(1)
}

describe('getMainCSPPolicy', () => {
  it('allows direct uploads to the build-time S3_ENDPOINT', () => {
    const sources = connectSources(getMainCSPPolicy())
    expect(sources).toContain('https://s3.de.io.cloud.ovh.net')
    expect(sources).toContain('https://*.s3.de.io.cloud.ovh.net')
  })

  it('keeps the restrictive security directives', () => {
    const policy = getMainCSPPolicy()

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("base-uri 'self'")
  })
})

describe('generateRuntimeCSP', () => {
  it('adds the runtime app, socket (with WebSocket variant) and brand origins', () => {
    const csp = generateRuntimeCSP()

    expect(csp).toContain('https://example.com')
    expect(csp).toContain('https://socket.example.com')
    expect(csp).toContain('wss://socket.example.com')
    expect(csp).toContain('https://brand.example.com')
  })

  it('should allow blob URLs for iframe-based PDF previews', () => {
    const frameSrcDirective = generateRuntimeCSP()
      .split('; ')
      .find((directive) => directive.startsWith('frame-src '))

    expect(frameSrcDirective).toContain('blob:')
  })
})

describe('generateRuntimeCSP S3_ENDPOINT sources', () => {
  afterEach(() => {
    setEnv({ S3_ENDPOINT: 'https://s3.de.io.cloud.ovh.net', S3_FORCE_PATH_STYLE: undefined })
  })

  it('allows the endpoint and its bucket subdomains for virtual-hosted addressing', () => {
    setEnv({ S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/' })
    const sources = connectSources(generateRuntimeCSP())
    expect(sources).toContain('https://acct.r2.cloudflarestorage.com')
    expect(sources).toContain('https://*.acct.r2.cloudflarestorage.com')
  })

  it('keeps a non-default port and drops the bucket wildcard under S3_FORCE_PATH_STYLE', () => {
    setEnv({ S3_ENDPOINT: 'https://minio.example.com:9000', S3_FORCE_PATH_STYLE: 'true' })
    const sources = connectSources(generateRuntimeCSP())
    expect(sources).toContain('https://minio.example.com:9000')
    expect(sources.some((s) => s.includes('*.minio.example.com'))).toBe(false)
  })

  it('does not build a wildcard over an IP endpoint, which is always path-style', () => {
    setEnv({ S3_ENDPOINT: 'http://10.0.0.5:9000' })
    const sources = connectSources(generateRuntimeCSP())
    expect(sources).toContain('http://10.0.0.5:9000')
    expect(sources.some((s) => s.includes('*.10.0.0.5'))).toBe(false)
  })

  it('ignores an endpoint without an http(s) scheme instead of emitting a broken source', () => {
    setEnv({ S3_ENDPOINT: 'minio.example.com:9000' })
    const csp = generateRuntimeCSP()
    expect(csp).not.toContain('minio.example.com')
    expect(connectSources(csp)).toContain("'self'")
  })
})

describe('getChatEmbedCSPPolicy', () => {
  it('allows embedding and Office.js without relaxing object-src or base-uri', () => {
    const policy = getChatEmbedCSPPolicy()
    expect(policy).toContain('frame-ancestors *')
    expect(policy).toMatch(/script-src[^;]*https:\/\/appsforoffice\.microsoft\.com/)
    expect(policy).toMatch(/connect-src[^;]*https:\/\/appsforoffice\.microsoft\.com/)
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
  })
})
