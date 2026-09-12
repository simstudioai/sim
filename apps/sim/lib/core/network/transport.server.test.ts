/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedOutboundRoute } from '@/lib/core/network/config.server'

const { resolveRoute, createGateway } = vi.hoisted(() => ({
  resolveRoute: vi.fn<() => Promise<ResolvedOutboundRoute>>(),
  createGateway: vi.fn(),
}))
vi.mock('@/lib/core/network/context.server', () => ({ resolveCurrentOutboundRoute: resolveRoute }))
vi.mock('@/lib/core/network/gateway.server', () => ({ createGatewayDispatcher: createGateway }))

import { createOutboundTransport } from '@/lib/core/network/transport.server'

const route = (scopeKey: string | null = 'org_a', revision = 'v1'): ResolvedOutboundRoute => ({
  kind: 'gateway',
  scopeKey,
  revision,
  gateway: {
    id: 'gateway',
    url: 'https://gateway.invalid',
    servername: 'gateway.invalid',
    generation: 'v1',
    token: 'synthetic',
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const name of [
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    vi.stubEnv(name, '')
  }
  resolveRoute.mockResolvedValue(route())
  createGateway.mockImplementation(() => ({
    close: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  }))
})

afterEach(() => vi.unstubAllEnvs())

describe('shared outbound transport ownership', () => {
  it('uses the organization gateway even when environment proxy configuration is invalid', async () => {
    vi.stubEnv('http_proxy', 'socks5://operator:synthetic@proxy.invalid')
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    try {
      expect(await owner.selectDispatcher()).toBe(createGateway.mock.results[0].value)
      expect(createGateway).toHaveBeenCalledOnce()
    } finally {
      await owner.destroy()
    }
  })

  it('rejects an explicit proxy when organization policy requires its gateway', async () => {
    const owner = createOutboundTransport({
      profile: 'configuredEndpoint',
      proxyUrl: 'http://proxy.invalid',
    })
    try {
      await expect(owner.selectDispatcher()).rejects.toThrow('UNSUPPORTED_TRANSPORT')
      expect(createGateway).not.toHaveBeenCalled()
    } finally {
      await owner.destroy()
    }
  })

  it('never shares personal and organization pools for the same gateway', async () => {
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    try {
      resolveRoute.mockResolvedValue(route(null))
      const personal = await owner.selectDispatcher()
      resolveRoute.mockResolvedValue(route('personal'))
      const organization = await owner.selectDispatcher()
      expect(organization).not.toBe(personal)
      resolveRoute.mockResolvedValue(route(null))
      expect(await owner.selectDispatcher()).toBe(personal)
      expect(createGateway).toHaveBeenCalledTimes(2)
    } finally {
      await owner.destroy()
    }
  })

  it('reuses only matching organization and revision pools and disposes all of them', async () => {
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    const first = await owner.selectDispatcher()
    expect(await owner.selectDispatcher()).toBe(first)
    resolveRoute.mockResolvedValue(route('org_b'))
    expect(await owner.selectDispatcher()).not.toBe(first)
    resolveRoute.mockResolvedValue(route('org_a', 'v2'))
    expect(await owner.selectDispatcher()).not.toBe(first)
    await owner.destroy()
    for (const result of createGateway.mock.results)
      expect(result.value.destroy).toHaveBeenCalledOnce()
    await expect(owner.selectDispatcher()).rejects.toThrow('GATEWAY_UNAVAILABLE')
  })

  it('delegates explicit direct routes but propagates policy failure without a fallback', async () => {
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    resolveRoute.mockResolvedValue({ kind: 'direct' })
    expect(await owner.selectDispatcher()).toBeNull()
    resolveRoute.mockRejectedValue(new Error('policy unavailable'))
    await expect(owner.selectDispatcher()).rejects.toThrow('policy unavailable')
    expect(createGateway).not.toHaveBeenCalled()
  })

  it('refuses to create a pool when its owner is destroyed during policy resolution', async () => {
    let resolve: (route: ResolvedOutboundRoute) => void = () => {}
    resolveRoute.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    const pending = owner.selectDispatcher()
    await owner.destroy()
    resolve(route())
    await expect(pending).rejects.toThrow('GATEWAY_UNAVAILABLE')
    expect(createGateway).not.toHaveBeenCalled()
  })

  it('bounds active and draining pools when revisions change while streams stay open', async () => {
    const drain: Array<() => void> = []
    createGateway.mockImplementation(() => ({
      close: vi.fn(() => new Promise<void>((done) => drain.push(done))),
      destroy: vi.fn(async () => {}),
    }))
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    try {
      for (let index = 0; index < 32; index++) {
        resolveRoute.mockResolvedValue(route('org_a', `v${index}`))
        expect(await owner.selectDispatcher()).not.toBeNull()
      }
      resolveRoute.mockResolvedValue(route('org_a', 'overflow'))
      await expect(owner.selectDispatcher()).rejects.toThrow('GATEWAY_UNAVAILABLE')
      expect(createGateway).toHaveBeenCalledTimes(32)
    } finally {
      await owner.destroy()
      for (const finish of drain) finish()
    }
  })
})
