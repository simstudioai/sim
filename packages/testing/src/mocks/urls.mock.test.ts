import { afterEach, describe, expect, it } from 'vitest'
import { defaultMockEnv, resetEnvMock, setEnv } from './env.mock'
import { resetUrlsMock, urlsMock, urlsMockFns } from './urls.mock'

describe('urls mock', () => {
  afterEach(() => {
    resetUrlsMock()
    resetEnvMock()
  })

  it('derives getBaseUrl from the shared env mock state', () => {
    expect(urlsMock.getBaseUrl()).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://custom.example.com' })
    expect(urlsMock.getBaseUrl()).toBe('https://custom.example.com')
  })

  it('throws from getBaseUrl when NEXT_PUBLIC_APP_URL is pinned unset', () => {
    setEnv({ NEXT_PUBLIC_APP_URL: undefined })
    expect(() => urlsMock.getBaseUrl()).toThrow('NEXT_PUBLIC_APP_URL must be configured')
  })

  it('getInternalApiBaseUrl prefers INTERNAL_API_BASE_URL and falls back to base URL', () => {
    expect(urlsMock.getInternalApiBaseUrl()).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
    setEnv({ INTERNAL_API_BASE_URL: 'http://sim-app.default.svc.cluster.local:3000' })
    expect(urlsMock.getInternalApiBaseUrl()).toBe('http://sim-app.default.svc.cluster.local:3000')
  })

  it('ensureAbsoluteUrl prefixes relative paths with the base URL', () => {
    expect(urlsMock.ensureAbsoluteUrl('/api/files/serve/x')).toBe(
      `${defaultMockEnv.NEXT_PUBLIC_APP_URL}/api/files/serve/x`
    )
    expect(urlsMock.ensureAbsoluteUrl('https://a.b/c')).toBe('https://a.b/c')
  })

  it('domain helpers derive from the base URL', () => {
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://www.sim.ai' })
    expect(urlsMock.getBaseDomain()).toBe('www.sim.ai')
    expect(urlsMock.getEmailDomain()).toBe('sim.ai')
  })

  it('pure helpers behave like the real module', () => {
    expect(urlsMock.isLoopbackHostname('localhost')).toBe(true)
    expect(urlsMock.isLoopbackHostname('sim.ai')).toBe(false)
    expect(urlsMock.isLocalhostUrl('http://127.0.0.1:3000')).toBe(true)
    expect(urlsMock.isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(urlsMock.isSafeHttpUrl('https://sim.ai')).toBe(true)
    expect(
      urlsMock.parseOriginList('https://a.example.com/path, https://a.example.com, bad-url')
    ).toEqual(['https://a.example.com'])
  })

  it('socket and ollama URLs read env with localhost fallbacks', () => {
    expect(urlsMock.getSocketServerUrl()).toBe('http://localhost:3002')
    expect(urlsMock.getOllamaUrl()).toBe('http://localhost:11434')
    setEnv({ SOCKET_SERVER_URL: 'http://sockets:3002', OLLAMA_URL: 'http://ollama:11434' })
    expect(urlsMock.getSocketServerUrl()).toBe('http://sockets:3002')
    expect(urlsMock.getOllamaUrl()).toBe('http://ollama:11434')
  })

  it('resetUrlsMock restores default implementations after overrides', () => {
    urlsMockFns.mockGetBaseUrl.mockReturnValue('https://overridden.test')
    expect(urlsMock.getBaseUrl()).toBe('https://overridden.test')
    resetUrlsMock()
    expect(urlsMock.getBaseUrl()).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
  })
})
