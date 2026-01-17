import { createEnvMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
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
)

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: false,
  isReactGrabEnabled: false,
}))

import {
  addCSPSource,
  buildCSPString,
  buildTimeCSPDirectives,
  type CSPDirectives,
  generateRuntimeCSP,
  getMainCSPPolicy,
  getWorkflowExecutionCSPPolicy,
  removeCSPSource,
} from './csp'

describe('buildCSPString', () => {
  it('should build CSP string from directives', () => {
    const directives: CSPDirectives = {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
    }

    const result = buildCSPString(directives)

    expect(result).toContain("default-src 'self'")
    expect(result).toContain("script-src 'self' 'unsafe-inline'")
    expect(result).toContain(';')
  })

  it('should handle empty directives', () => {
    const directives: CSPDirectives = {}
    const result = buildCSPString(directives)
    expect(result).toBe('')
  })

  it('should skip empty source arrays', () => {
    const directives: CSPDirectives = {
      'default-src': ["'self'"],
      'script-src': [],
    }

    const result = buildCSPString(directives)

    expect(result).toContain("default-src 'self'")
    expect(result).not.toContain('script-src')
  })

  it('should filter out empty string sources', () => {
    const directives: CSPDirectives = {
      'default-src': ["'self'", '', '  ', 'https://example.com'],
    }

    const result = buildCSPString(directives)

    expect(result).toContain("default-src 'self' https://example.com")
    expect(result).not.toMatch(/\s{2,}/)
  })

  it('should handle all directive types', () => {
    const directives: CSPDirectives = {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'media-src': ["'self'"],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'frame-ancestors': ["'self'"],
      'form-action': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
    }

    const result = buildCSPString(directives)

    expect(result).toContain("default-src 'self'")
    expect(result).toContain("script-src 'self'")
    expect(result).toContain("object-src 'none'")
  })
})

describe('getMainCSPPolicy', () => {
  it('should return a valid CSP policy string', () => {
    const policy = getMainCSPPolicy()

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain('script-src')
    expect(policy).toContain('style-src')
    expect(policy).toContain('img-src')
  })

  it('should include security directives', () => {
    const policy = getMainCSPPolicy()

    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("base-uri 'self'")
  })

  it('should include necessary external resources', () => {
    const policy = getMainCSPPolicy()

    expect(policy).toContain('https://fonts.googleapis.com')
    expect(policy).toContain('https://fonts.gstatic.com')
    expect(policy).toContain('https://*.google.com')
  })
})

describe('getWorkflowExecutionCSPPolicy', () => {
  it('should return permissive CSP for workflow execution', () => {
    const policy = getWorkflowExecutionCSPPolicy()

    expect(policy).toContain('default-src *')
    expect(policy).toContain("'unsafe-inline'")
    expect(policy).toContain("'unsafe-eval'")
    expect(policy).toContain('connect-src *')
  })

  it('should be more permissive than main CSP', () => {
    const mainPolicy = getMainCSPPolicy()
    const execPolicy = getWorkflowExecutionCSPPolicy()

    expect(execPolicy.length).toBeLessThan(mainPolicy.length)
    expect(execPolicy).toContain('*')
  })
})

describe('generateRuntimeCSP', () => {
  it('should generate CSP with runtime environment variables', () => {
    const csp = generateRuntimeCSP()

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('https://example.com')
  })

  it('should include socket URL and WebSocket variant', () => {
    const csp = generateRuntimeCSP()

    expect(csp).toContain('https://socket.example.com')
    expect(csp).toContain('wss://socket.example.com')
  })

  it('should include brand URLs', () => {
    const csp = generateRuntimeCSP()

    expect(csp).toContain('https://brand.example.com')
  })

  it('should not have excessive whitespace', () => {
    const csp = generateRuntimeCSP()

    expect(csp).not.toMatch(/\s{3,}/)
    expect(csp.trim()).toBe(csp)
  })
})

describe('addCSPSource', () => {
  const originalDirectives = JSON.parse(JSON.stringify(buildTimeCSPDirectives))

  afterEach(() => {
    Object.keys(buildTimeCSPDirectives).forEach((key) => {
      const k = key as keyof CSPDirectives
      buildTimeCSPDirectives[k] = originalDirectives[k]
    })
  })

  it('should add a source to an existing directive', () => {
    const originalLength = buildTimeCSPDirectives['img-src']?.length || 0

    addCSPSource('img-src', 'https://new-source.com')

    expect(buildTimeCSPDirectives['img-src']).toContain('https://new-source.com')
    expect(buildTimeCSPDirectives['img-src']?.length).toBe(originalLength + 1)
  })

  it('should not add duplicate sources', () => {
    addCSPSource('img-src', 'https://duplicate.com')
    const lengthAfterFirst = buildTimeCSPDirectives['img-src']?.length || 0

    addCSPSource('img-src', 'https://duplicate.com')

    expect(buildTimeCSPDirectives['img-src']?.length).toBe(lengthAfterFirst)
  })

  it('should create directive array if it does not exist', () => {
    ;(buildTimeCSPDirectives as any)['worker-src'] = undefined

    addCSPSource('script-src', 'https://worker.example.com')

    expect(buildTimeCSPDirectives['script-src']).toContain('https://worker.example.com')
  })
})

describe('removeCSPSource', () => {
  const originalDirectives = JSON.parse(JSON.stringify(buildTimeCSPDirectives))

  afterEach(() => {
    Object.keys(buildTimeCSPDirectives).forEach((key) => {
      const k = key as keyof CSPDirectives
      buildTimeCSPDirectives[k] = originalDirectives[k]
    })
  })

  it('should remove a source from an existing directive', () => {
    addCSPSource('img-src', 'https://to-remove.com')
    expect(buildTimeCSPDirectives['img-src']).toContain('https://to-remove.com')

    removeCSPSource('img-src', 'https://to-remove.com')

    expect(buildTimeCSPDirectives['img-src']).not.toContain('https://to-remove.com')
  })

  it('should handle removing non-existent source gracefully', () => {
    const originalLength = buildTimeCSPDirectives['img-src']?.length || 0

    removeCSPSource('img-src', 'https://non-existent.com')

    expect(buildTimeCSPDirectives['img-src']?.length).toBe(originalLength)
  })

  it('should handle removing from non-existent directive gracefully', () => {
    ;(buildTimeCSPDirectives as any)['worker-src'] = undefined

    expect(() => {
      removeCSPSource('script-src', 'https://anything.com')
    }).not.toThrow()
  })
})

describe('buildTimeCSPDirectives', () => {
  it('should have all required security directives', () => {
    expect(buildTimeCSPDirectives['default-src']).toBeDefined()
    expect(buildTimeCSPDirectives['object-src']).toContain("'none'")
    expect(buildTimeCSPDirectives['frame-ancestors']).toContain("'self'")
    expect(buildTimeCSPDirectives['base-uri']).toContain("'self'")
  })

  it('should have self as default source', () => {
    expect(buildTimeCSPDirectives['default-src']).toContain("'self'")
  })

  it('should allow Google fonts', () => {
    expect(buildTimeCSPDirectives['style-src']).toContain('https://fonts.googleapis.com')
    expect(buildTimeCSPDirectives['font-src']).toContain('https://fonts.gstatic.com')
  })

  it('should allow data: and blob: for images', () => {
    expect(buildTimeCSPDirectives['img-src']).toContain('data:')
    expect(buildTimeCSPDirectives['img-src']).toContain('blob:')
  })
})
