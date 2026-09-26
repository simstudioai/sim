import { describe, expect, it, vi } from 'vitest'

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
  })
})

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

describe('getMainCSPPolicy', () => {
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
