import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, proxy, resolveApiCorsPolicy } from '@/proxy'

setEnv({
  NEXT_PUBLIC_APP_URL: 'https://app.sim.test',
  SIM_MCP_URL: 'https://mcp.sim.test/mcp',
})
afterAll(resetEnvMock)

describe('browser extension frame boundary', () => {
  afterEach(() => setEnv({ BROWSER_EXTENSION_IDS: undefined }))

  it('allows only configured extension ancestors on the dedicated surface', async () => {
    setEnv({ BROWSER_EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop' })
    const response = await proxy(new NextRequest('https://app.sim.test/extension/workspace-1'))
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'frame-ancestors chrome-extension://abcdefghijklmnopabcdefghijklmnop;'
    )
    expect(response.headers.has('X-Frame-Options')).toBe(false)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')

    const ordinary = await proxy(new NextRequest('https://app.sim.test/login'))
    expect(ordinary.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'")
    expect(ordinary.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it.each([
    undefined,
    '',
    '*',
    'abcdefghijklmnopabcdefghijklmnop, https://evil.test',
    'a'.repeat(2048),
  ])(
    'refuses embedding with absent or invalid deployment configuration: %s',
    async (configured) => {
      setEnv({ BROWSER_EXTENSION_IDS: configured })
      const response = await proxy(new NextRequest('https://app.sim.test/extension'))
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    }
  )
})

const EXPOSED_HEADERS =
  'Retry-After, WWW-Authenticate, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, X-Run-Id'

function makeRequest(pathname: string, origin?: string): NextRequest {
  return {
    nextUrl: { pathname },
    headers: {
      get: (name: string) => (name.toLowerCase() === 'origin' ? (origin ?? null) : null),
    },
  } as unknown as NextRequest
}

describe('resolveApiCorsPolicy', () => {
  it('serves OAuth2 routes with wildcard origin and no credentials', () => {
    expect(resolveApiCorsPolicy(makeRequest('/api/auth/oauth2/token'))).toEqual({
      origin: '*',
      credentials: false,
      methods: 'GET, POST, OPTIONS',
      headers: 'Content-Type, Authorization, Accept',
      exposeHeaders: EXPOSED_HEADERS,
    })
  })

  it('serves OAuth discovery documents read-only with wildcard origin', () => {
    expect(
      resolveApiCorsPolicy(makeRequest('/api/auth/.well-known/oauth-authorization-server'))
    ).toEqual({
      origin: '*',
      credentials: false,
      methods: 'GET, OPTIONS',
      headers: 'Content-Type, Accept',
      exposeHeaders: EXPOSED_HEADERS,
    })
  })

  it('reflects origin for chat embeds with credentials enabled', () => {
    const paths = ['/api/chat/abc', '/api/chat/abc/otp', '/api/chat/abc/sso']
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path, 'https://customer.example'))
      expect(policy).toEqual({
        origin: 'https://customer.example',
        credentials: true,
        methods: 'GET, POST, PUT, OPTIONS',
        headers: 'Content-Type, X-Requested-With',
        exposeHeaders: EXPOSED_HEADERS,
      })
    }
  })

  it('drops credentials on embed policy when Origin header is absent (CORS spec invariant)', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/chat/abc'))
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
  })

  it('serves workflow execute with wildcard origin and execution identity header', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/workflows/workflow-123/execute', 'https://other.example')
    )
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
    expect(policy.methods).toContain('PUT')
    expect(policy.headers).toContain('X-Execution-Id')
    expect(policy.headers).toContain('X-Execution-Timeout-Seconds')
  })

  it('does not match the v2 execute rule for nested or runs paths', () => {
    const nested = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/execute/extra', 'https://other.example')
    )
    expect(nested.origin).toBe('https://app.sim.test')
    const runs = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/runs/run-1', 'https://other.example')
    )
    expect(runs.origin).toBe('https://app.sim.test')
  })

  it('returns default policy with APP_URL and credentials for other API routes', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/files/uploads'))
    expect(policy).toEqual({
      origin: 'https://app.sim.test',
      credentials: true,
      methods: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      exposeHeaders: EXPOSED_HEADERS,
      headers: expect.stringContaining('Authorization'),
    })
  })

  it('exposes the response headers on every matched rule, so a new rule cannot drop them', () => {
    const paths = [
      '/api/auth/oauth2/token',
      '/api/mcp/copilot',
      '/api/chat/abc',
      '/api/workflows/wf/execute',
      '/api/v2/workflows/wf/execute',
      '/api/files/uploads',
    ]
    for (const path of paths) {
      expect(resolveApiCorsPolicy(makeRequest(path)).exposeHeaders).toBe(EXPOSED_HEADERS)
    }
  })

  it('never pairs wildcard origin with credentials (CORS spec invariant)', () => {
    const paths = [
      '/api/auth/oauth2/token',
      '/api/mcp/copilot',
      '/api/chat/abc',
      '/api/workflows/wf/execute',
      '/api/v2/workflows/wf/execute',
      '/api/files/uploads',
    ]
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path))
      if (policy.origin === '*') {
        expect(policy.credentials).toBe(false)
      }
    }
  })
})

describe('proxy on the dedicated MCP host', () => {
  function mcpRequest(pathname: string, method = 'POST') {
    return new NextRequest(`https://mcp.sim.test${pathname}`, {
      method,
      headers: { host: 'mcp.sim.test', origin: 'https://app.sim.test' },
    })
  }

  it('answers the endpoint preflight with the API CORS policy', async () => {
    const response = await proxy(mcpRequest('/mcp', 'OPTIONS'))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.sim.test')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('serves nothing else on the MCP host', async () => {
    expect((await proxy(mcpRequest('/login', 'GET'))).status).toBe(404)
  })

  it.each(['', 'python-requests/2.32.3'])(
    'allows ownership verification with an automated user agent: %s',
    async (userAgent) => {
      const request = mcpRequest('/.well-known/openai-apps-challenge', 'GET')
      if (userAgent) request.headers.set('user-agent', userAgent)
      expect((await proxy(request)).status).toBe(200)
      expect(
        (await proxy(mcpRequest('/.well-known/openai-apps-challenge/other', 'GET'))).status
      ).toBe(404)
    }
  )
})

describe('proxy indexing policy', () => {
  afterEach(resetEnvFlagsMock)

  const robotsTag = async (pathname: string) =>
    (await proxy(new NextRequest(`https://self-hosted.example${pathname}`))).headers.get(
      'X-Robots-Tag'
    )

  it('keeps the marketing pages of a self-hosted deployment out of search results', async () => {
    setEnvFlags({ isHosted: false })
    expect(await robotsTag('/comparisons/n8n')).toBe('noindex, nofollow')
    expect(await robotsTag('/pricing')).toBe('noindex, nofollow')
  })

  it('keeps the marketing documents of a self-hosted deployment out of search results', async () => {
    setEnvFlags({ isHosted: false })
    expect(await robotsTag('/index.md')).toBe('noindex, nofollow')
    expect(await robotsTag('/llms.txt')).toBe('noindex, nofollow')
    expect(await robotsTag('/llms-full.txt')).toBe('noindex, nofollow')
    expect(await robotsTag('/changelog.xml')).toBe('noindex, nofollow')
    expect(await robotsTag('/library.md/some-article')).toBe('noindex, nofollow')
  })

  it('leaves the marketing pages and documents of the hosted deployment indexable', async () => {
    setEnvFlags({ isHosted: true })
    expect(await robotsTag('/comparisons/n8n')).toBeNull()
    expect(await robotsTag('/pricing')).toBeNull()
    expect(await robotsTag('/index.md')).toBeNull()
    expect(await robotsTag('/llms.txt')).toBeNull()
    expect(await robotsTag('/llms-full.txt')).toBeNull()
    expect(await robotsTag('/changelog.xml')).toBeNull()
    expect(await robotsTag('/library.md/some-article')).toBeNull()
  })

  it.each([
    '/login',
    '/signup',
    '/verify',
    '/oauth/consent',
    '/invite/example',
    '/desktop/auth',
    '/cli/auth',
    '/credential-groups/enroll/example',
    '/f/example',
    '/chat/example',
  ])('keeps Auth out of search results on every deployment: %s', async (pathname) => {
    for (const isHosted of [false, true]) {
      setEnvFlags({ isHosted })
      expect(await robotsTag(pathname)).toBe('noindex, nofollow')
    }
  })
})

describe('proxy matcher', () => {
  const matches = (path: string) =>
    unstable_doesMiddlewareMatch({ config, url: `https://sim.test${path}` })

  it('leaves the desktop raw upload routes unbuffered, so a whole file reaches the route', () => {
    expect(matches('/api/desktop/tool/import')).toBe(false)
    expect(matches('/api/desktop/tool/file')).toBe(false)
  })

  it('leaves the document snapshot persists unbuffered, so a whole snapshot reaches the route', () => {
    expect(matches('/api/internal/file-doc/persist')).toBe(false)
    expect(matches('/api/internal/project-file-doc/project-1/file-1/persist')).toBe(false)
  })

  it('runs for the marketing documents, so the indexing policy reaches them', () => {
    expect(matches('/index.md')).toBe(true)
    expect(matches('/llms.txt')).toBe(true)
    expect(matches('/llms-full.txt')).toBe(true)
    expect(matches('/changelog.xml')).toBe(true)
    expect(matches('/library.md/some-article')).toBe(true)
  })

  it('still runs for every other API route', () => {
    expect(matches('/api/desktop/tool/claim')).toBe(true)
    expect(matches('/api/desktop/tool/import/other')).toBe(true)
    expect(matches('/api/workflows/wf-1/execute')).toBe(true)
    expect(matches('/api/files/upload')).toBe(true)
    expect(matches('/api/internal/project-file-doc/project-1/file-1/seed')).toBe(true)
    expect(matches('/api/internal/project-file-doc/project-1/file-1/persist/other')).toBe(true)
    expect(matches('/api/internal/file-doc/persist/other')).toBe(true)
    expect(matches('/api/internal/file-doc/seed')).toBe(true)
  })
})

/**
 * The zone's real availability answer over real HTTP, because the rewrite gives a browser nothing to
 * recover from: Next answers a failed proxy with a bare 500. Each case takes its own port, which is
 * also the availability cache's key, so no case reads another's answer.
 */
describe('Platform zone outage', () => {
  const LEGACY_URL = 'x-middleware-request-x-sim-legacy-url'
  const servers: Server[] = []
  let answer = 404

  const listen = (handler: Parameters<typeof createServer>[1]) =>
    new Promise<string>((resolve) => {
      const server = createServer(handler)
      servers.push(server)
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      })
    })

  const zoneAnswering = (status: number) =>
    listen((_request, response) => {
      response.writeHead(status, status === 307 ? { location: 'http://127.0.0.1:1/dead' } : {})
      response.end()
    })

  /** Binds a port and frees it, so a connection to it is refused. */
  async function refusedOrigin() {
    const origin = await zoneAnswering(404)
    const server = servers.pop()
    await new Promise((resolve) => server?.close(resolve))
    return origin
  }

  const deploy = (origin: string | undefined) => {
    vi.stubEnv('SIM_PLATFORM_ZONE_REWRITE', origin ? '1' : '')
    setEnv({ SIM_PLATFORM_ORIGIN: origin })
  }

  const open = (pathname: string, init: { method?: string; legacyHeader?: string } = {}) =>
    proxy(
      new NextRequest(`https://app.sim.test${pathname}`, {
        method: init.method ?? 'GET',
        headers: {
          cookie: 'better-auth.session_token=session',
          'user-agent': 'Mozilla/5.0',
          ...(init.legacyHeader && { 'x-sim-legacy-url': init.legacyHeader }),
        },
      })
    )

  const sentBackToTheOrganizationSurface = (response: Response) => {
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/o')
  }

  const passedThrough = (response: Response) => {
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  }

  beforeAll(() => {
    vi.unstubAllGlobals()
  })

  afterEach(async () => {
    setEnv({ SIM_PLATFORM_ORIGIN: undefined })
    answer = 404
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections()
        return new Promise((resolve) => server.close(resolve))
      })
    )
  })

  describe.each([
    ['refuses connections', refusedOrigin],
    ['answers 500', () => zoneAnswering(500)],
    ['answers 503', () => zoneAnswering(503)],
    ['hangs', () => listen(() => {})],
  ])('when the zone %s', (_name, startZone) => {
    it('sends a Platform page and a client navigation back to the main app', async () => {
      deploy(await startZone())
      sentBackToTheOrganizationSurface(await open('/org/settings/members?search=rae'))
      sentBackToTheOrganizationSurface(await open('/org'))
    })

    it('renders an organization route in place, with no handoff to read, even a forged one', async () => {
      deploy(await startZone())
      const response = await open('/o/org-1/home', { legacyHeader: '/o/org-1/people' })
      passedThrough(response)
      expect(response.headers.get(LEGACY_URL)).toBeNull()
    })
  })

  it('leaves what a redirect cannot help alone: zone assets and writes', async () => {
    deploy(await refusedOrigin())
    passedThrough(await open('/org/_next/image?url=x'))
    passedThrough(await open('/org/settings/members', { method: 'POST' }))
  })

  it.each([
    ['a 404, the zone rendering its own not-found page', 404],
    ['a 200', 200],
    ['a redirect, which it does not follow', 307],
  ])('counts %s as a healthy zone', async (_name, status) => {
    deploy(await zoneAnswering(status))
    passedThrough(await open('/org/home'))
    const response = await open('/o/org-1/home?tab=a', { legacyHeader: '/o/org-1/people' })
    passedThrough(response)
    expect(response.headers.get(LEGACY_URL)).toBe('/o/org-1/home?tab=a')
  })

  it('hands back to the zone once it recovers', async () => {
    deploy(
      await listen((_request, response) => {
        response.writeHead(answer)
        response.end()
      })
    )
    answer = 503
    sentBackToTheOrganizationSurface(await open('/org/home'))
    answer = 404
    await vi.waitFor(async () => passedThrough(await open('/org/home')), {
      timeout: 15_000,
      interval: 250,
    })
  }, 20_000)

  it('notices an outage on its own, without waiting for a restart', async () => {
    deploy(
      await listen((_request, response) => {
        response.writeHead(answer)
        response.end()
      })
    )
    passedThrough(await open('/org/home'))
    answer = 503
    await vi.waitFor(async () => sentBackToTheOrganizationSurface(await open('/org/home')), {
      timeout: 15_000,
      interval: 250,
    })
  }, 20_000)

  it('asks nothing of a deployment with no zone', async () => {
    const requests = vi.fn()
    const origin = await listen((_request, response) => {
      requests()
      response.writeHead(503)
      response.end()
    })
    setEnv({ SIM_PLATFORM_ORIGIN: origin })
    vi.stubEnv('SIM_PLATFORM_ZONE_REWRITE', '')
    passedThrough(await open('/o/org-1/home'))
    await open('/org/home')
    expect(requests).not.toHaveBeenCalled()
  })

  it('runs for a Platform page but not its static assets', () => {
    const matches = (path: string) =>
      unstable_doesMiddlewareMatch({ config, url: `https://sim.test${path}` })
    expect(matches('/org')).toBe(true)
    expect(matches('/org/settings/members')).toBe(true)
    expect(matches('/org/_next/static/chunk.js')).toBe(false)
  })
})

describe('signed-in login with an OAuth authorize callback', () => {
  function signedInLogin(callbackUrl: string) {
    const url = new URL('https://app.sim.test/login')
    url.searchParams.set('callbackUrl', callbackUrl)
    return new NextRequest(url, {
      headers: { cookie: 'better-auth.session_token=session-token.signature' },
    })
  }

  it('shows the form so an OAuth client can reauthenticate its user', async () => {
    const response = await proxy(
      signedInLogin('/api/auth/oauth2/authorize?client_id=sim-cli&response_type=code')
    )
    expect(response.headers.get('location')).toBeNull()
  })

  it('sends a workspace account launch to the app instead of through sign-in', async () => {
    const response = await proxy(
      signedInLogin('/api/auth/oauth2/authorize?providerId=google-email&workspaceId=workspace-1')
    )
    expect(response.headers.get('location')).toBe('https://app.sim.test/home')
  })
})
