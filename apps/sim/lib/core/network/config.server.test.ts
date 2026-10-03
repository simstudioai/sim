import { describe, expect, it, vi } from 'vitest'
import { createOutboundRoutingReader } from '@/lib/core/network/config.server'

const document = {
  schemaVersion: 1,
  revision: 'revision-1',
  organizations: { org_a: { kind: 'gateway', gatewayId: 'gateway_a' } },
}
const catalog = {
  gateway_a: {
    organizationId: 'org_a',
    url: 'https://proxy.example.invalid/',
    credentialId: 'credential_a',
  },
}
const credentials = { credential_a: { token: 'synthetic-test-token-0000000000000000' } }
const options = {
  source: 'env',
  configuration: JSON.stringify(document),
  gateways: JSON.stringify(catalog),
  credentials: JSON.stringify(credentials),
}
const dependencies = { now: () => 400_000, readSnapshot: vi.fn() }

describe('outbound configuration', () => {
  it('keeps unconfigured OSS deployments independent of AWS and organization context', async () => {
    const readSnapshot = vi.fn()
    const reader = createOutboundRoutingReader({}, { ...dependencies, readSnapshot })
    expect(reader.enabled).toBe(false)
    expect(await reader.resolve(undefined)).toEqual({ kind: 'direct' })
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it.each([undefined, '{}'])(
    'rejects missing AppConfig gateway catalog %s before routing',
    (gateways) => {
      expect(() =>
        createOutboundRoutingReader(
          {
            ...options,
            source: 'appconfig',
            configuration: undefined,
            gateways,
          },
          dependencies
        )
      ).toThrow('INVALID_CONFIGURATION')
    }
  )

  it('does not treat missing context as a personal workspace', async () => {
    const reader = createOutboundRoutingReader(options, dependencies)
    await expect(reader.resolve(undefined)).rejects.toThrow('MISSING_SCOPE')
    expect(await reader.resolve(null)).toEqual({ kind: 'direct' })
    expect(await reader.resolve('org_a')).toMatchObject({
      kind: 'gateway',
      gateway: { id: 'gateway_a' },
    })
  })

  it('rejects assignments to another organization and gateway defaults', () => {
    for (const overrides of [
      { defaultRoute: { kind: 'gateway', gatewayId: 'gateway_a' } },
      { organizations: { org_b: { kind: 'gateway', gatewayId: 'gateway_a' } } },
    ]) {
      expect(() =>
        createOutboundRoutingReader(
          {
            ...options,
            configuration: JSON.stringify({ ...document, ...overrides }),
          },
          dependencies
        )
      ).toThrow('INVALID_CONFIGURATION')
    }
  })

  it('refuses to share an endpoint or credential between organizations', () => {
    for (const gateway of [
      { ...catalog.gateway_a, organizationId: 'org_b' },
      { ...catalog.gateway_a, organizationId: 'org_b', url: 'https://second.invalid/' },
    ]) {
      expect(() =>
        createOutboundRoutingReader(
          {
            ...options,
            gateways: JSON.stringify({ ...catalog, gateway_b: gateway }),
          },
          dependencies
        )
      ).toThrow('INVALID_CONFIGURATION')
    }
  })

  it('does not release a reserved organization when its assignment is removed', async () => {
    const reader = createOutboundRoutingReader(
      {
        ...options,
        configuration: JSON.stringify({ ...document, organizations: {} }),
      },
      dependencies
    )
    await expect(reader.resolve('org_a')).rejects.toThrow('ROUTE_BLOCKED')
    expect(await reader.resolve('org_other')).toEqual({ kind: 'direct' })
  })

  it('uses explicit direct and blocked assignments only for reserved organizations', async () => {
    for (const kind of ['direct', 'blocked']) {
      const reader = createOutboundRoutingReader(
        {
          ...options,
          configuration: JSON.stringify({
            ...document,
            organizations: { org_a: { kind } },
          }),
        },
        dependencies
      )
      if (kind === 'direct') {
        expect(await reader.resolve('org_a')).toEqual({ kind: 'direct' })
      } else {
        await expect(reader.resolve('org_a')).rejects.toThrow('ROUTE_BLOCKED')
      }
      expect(await reader.resolve('constructor')).toEqual({ kind: 'direct' })
    }
  })

  it('rejects an outbound IP published for two different owners', () => {
    expect(() =>
      createOutboundRoutingReader(
        {
          ...options,
          credentials: JSON.stringify({ ...credentials, credential_b: { token: 'b'.repeat(48) } }),
          gateways: JSON.stringify({
            gateway_a: { ...catalog.gateway_a, publicIps: ['192.0.2.10'] },
            gateway_b: {
              ...catalog.gateway_a,
              organizationId: 'org_b',
              url: 'https://second.invalid/',
              credentialId: 'credential_b',
              publicIps: ['192.0.2.10'],
            },
          }),
        },
        dependencies
      )
    ).toThrow('INVALID_CONFIGURATION')
  })

  it.each([
    { ...options, source: undefined },
    { ...options, configuration: undefined },
    { ...options, gateways: '{}' },
    { ...options, credentials: '{}' },
    {
      ...options,
      gateways: JSON.stringify({
        gateway_a: { ...catalog.gateway_a, url: 'http://proxy.example.invalid/' },
      }),
    },
    {
      ...options,
      gateways: JSON.stringify({
        gateway_a: { ...catalog.gateway_a, url: 'https://user:password@proxy.example.invalid/' },
      }),
    },
  ])('rejects incomplete or unsafe operator configuration', (input) => {
    expect(() => createOutboundRoutingReader(input, dependencies)).toThrow('INVALID_CONFIGURATION')
  })

  it('never falls back to direct routing on cold, stale or future snapshots', async () => {
    for (const validatedAt of [null, 100_000, 500_000]) {
      const reader = createOutboundRoutingReader(
        { ...options, source: 'appconfig', configuration: undefined },
        {
          ...dependencies,
          readSnapshot: async (parse) => ({ value: parse(document), validatedAt }),
        }
      )
      await expect(reader.resolve('org_a')).rejects.toThrow('CONFIGURATION_UNAVAILABLE')
      expect(await reader.resolve('org_other')).toEqual({ kind: 'direct' })
      expect(await reader.resolve(null)).toEqual({ kind: 'direct' })
    }
  })

  it('never reads AppConfig for organizations without a reservation', async () => {
    const readSnapshot = vi.fn().mockRejectedValue(new Error('AppConfig unavailable'))
    const reader = createOutboundRoutingReader(
      { ...options, source: 'appconfig', configuration: undefined },
      { ...dependencies, readSnapshot }
    )
    expect(await reader.resolve('org_other')).toEqual({ kind: 'direct' })
    expect(await reader.resolve(null)).toEqual({ kind: 'direct' })
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it('keeps a still-valid snapshot and re-resolves current routing for each operation', async () => {
    let current: unknown = document
    const reader = createOutboundRoutingReader(
      { ...options, source: 'appconfig', configuration: undefined },
      {
        ...dependencies,
        readSnapshot: async (parse) => ({ value: parse(current), validatedAt: 350_000 }),
      }
    )
    expect(await reader.resolve('org_a')).toMatchObject({ kind: 'gateway' })
    current = {
      ...document,
      revision: 'revision-2',
      organizations: { org_a: { kind: 'blocked' } },
    }
    await expect(reader.resolve('org_a')).rejects.toThrow('ROUTE_BLOCKED')
  })
})
