/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { createOutboundRoutingReader } from '@/lib/core/network/config.server'

const document = {
  schemaVersion: 1,
  revision: 'revision-1',
  defaultRoute: { kind: 'direct' },
  organizations: { org_a: { kind: 'gateway', gatewayId: 'gateway_a' } },
}
const catalog = {
  gateway_a: {
    url: 'https://proxy.example.invalid/',
    credentialId: 'credential_a',
    generation: 'generation-1',
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

  it('does not treat missing context as a personal workspace', async () => {
    const reader = createOutboundRoutingReader(options, dependencies)
    await expect(reader.resolve(undefined)).rejects.toThrow('MISSING_SCOPE')
    expect(await reader.resolve(null)).toEqual({ kind: 'direct' })
    expect(await reader.resolve('org_a')).toMatchObject({
      kind: 'gateway',
      scopeKey: 'org_a',
      gateway: { id: 'gateway_a' },
    })
  })

  it('keeps personal scope distinct from an organization named personal', async () => {
    const gatewayRoute = { kind: 'gateway', gatewayId: 'gateway_a' }
    const reader = createOutboundRoutingReader(
      {
        ...options,
        configuration: JSON.stringify({
          ...document,
          defaultRoute: gatewayRoute,
          organizations: { personal: gatewayRoute },
        }),
      },
      dependencies
    )
    expect(await reader.resolve(null)).toMatchObject({ kind: 'gateway', scopeKey: null })
    expect(await reader.resolve('personal')).toMatchObject({
      kind: 'gateway',
      scopeKey: 'personal',
    })
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
      await expect(reader.resolve('org_other')).rejects.toThrow('CONFIGURATION_UNAVAILABLE')
    }
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
