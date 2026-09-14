/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedOutboundRoute } from '@/lib/core/network/config.server'

const { resolveRoute, createGateway } = vi.hoisted(() => ({
  resolveRoute: vi.fn<() => Promise<ResolvedOutboundRoute>>(),
  createGateway: vi.fn(),
}))
vi.mock('@/lib/core/network/context.server', () => ({ resolveCurrentOutboundRoute: resolveRoute }))
vi.mock('@/lib/core/network/gateway.server', () => ({ createGatewayDispatcher: createGateway }))

import { createOutboundTransport } from '@/lib/core/network/transport.server'

const route = (
  organizationId = 'org_a',
  gatewayId = `gateway-${organizationId}`
): ResolvedOutboundRoute => ({
  kind: 'gateway',
  gateway: {
    id: gatewayId,
    organizationId,
    url: 'https://gateway.invalid',
    servername: 'gateway.invalid',
    token: 'synthetic',
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveRoute.mockResolvedValue(route())
  createGateway.mockImplementation(() => ({
    close: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  }))
})

describe('shared outbound transport ownership', () => {
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

  it('isolates organizations, reuses gateway pools, and disposes pools', async () => {
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    const first = await owner.selectDispatcher()
    expect(await owner.selectDispatcher()).toBe(first)
    resolveRoute.mockResolvedValue(route('org_b'))
    expect(await owner.selectDispatcher()).not.toBe(first)
    resolveRoute.mockResolvedValue(route('org_a'))
    expect(await owner.selectDispatcher()).toBe(first)
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

  it('bounds gateway changes per organization without blocking other organizations', async () => {
    const drain: Array<() => void> = []
    createGateway.mockImplementation(() => ({
      close: vi.fn(() => new Promise<void>((done) => drain.push(done))),
      destroy: vi.fn(async () => {}),
    }))
    const owner = createOutboundTransport({ profile: 'configuredEndpoint' })
    try {
      for (let index = 0; index < 3; index++) {
        resolveRoute.mockResolvedValue(route('org_a', `v${index}`))
        expect(await owner.selectDispatcher()).not.toBeNull()
      }
      resolveRoute.mockResolvedValue(route('org_a', 'overflow'))
      await expect(owner.selectDispatcher()).rejects.toThrow('GATEWAY_UNAVAILABLE')
      expect(createGateway).toHaveBeenCalledTimes(3)
      resolveRoute.mockResolvedValue(route('org_b'))
      expect(await owner.selectDispatcher()).not.toBeNull()
    } finally {
      await owner.destroy()
      for (const finish of drain) finish()
    }
  })
})
