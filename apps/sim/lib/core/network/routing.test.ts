/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseOutboundJson, parseOutboundRoutingConfig } from '@/lib/core/network/routing'

const document = {
  schemaVersion: 1,
  revision: 'revision-1',
  organizations: { org_a: { kind: 'gateway', gatewayId: 'gateway_a' }, org_b: { kind: 'blocked' } },
}

describe('outbound routing policy', () => {
  it('cannot be mutated', () => {
    const policy = parseOutboundRoutingConfig(document)
    expect(Object.isFrozen(policy.organizations.org_a)).toBe(true)
    expect(Object.isFrozen(policy.organizations)).toBe(true)
  })

  it.each([
    { ...document, schemaVersion: 2 },
    { ...document, organizations: { org_a: { kind: 'gateway' } } },
    { ...document, defaultRoute: { kind: 'blocked' } },
    { ...document, extra: true },
  ])('rejects malformed policy without exposing its content', (input) => {
    expect(() => parseOutboundRoutingConfig(input)).toThrow('INVALID_CONFIGURATION')
  })

  it('bounds serialized configuration and does not expose JSON syntax errors', () => {
    expect(() => parseOutboundJson('sensitive-value')).toThrow('INVALID_CONFIGURATION')
    expect(() => parseOutboundJson(' '.repeat(1_048_577))).toThrow('INVALID_CONFIGURATION')
  })
})
