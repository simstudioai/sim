/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  parseOutboundJson,
  parseOutboundRoutingConfig,
  selectOutboundRoute,
} from '@/lib/core/network/routing'

const document = {
  schemaVersion: 1,
  revision: 'revision-1',
  defaultRoute: { kind: 'direct' },
  organizations: { org_a: { kind: 'gateway', gatewayId: 'gateway_a' }, org_b: { kind: 'blocked' } },
}

describe('outbound routing policy', () => {
  it('selects exact organization bindings, including a deliberate stop', () => {
    const policy = parseOutboundRoutingConfig(document)
    expect(selectOutboundRoute(policy, 'org_a')).toEqual({
      kind: 'gateway',
      gatewayId: 'gateway_a',
    })
    expect(selectOutboundRoute(policy, 'org_c')).toEqual({ kind: 'direct' })
    expect(selectOutboundRoute(policy, null)).toEqual({ kind: 'direct' })
    expect(() => selectOutboundRoute(policy, 'org_b')).toThrow('ROUTE_BLOCKED')
  })

  it('cannot be mutated or inherit a binding from Object.prototype', () => {
    const policy = parseOutboundRoutingConfig(document)
    expect(Object.isFrozen(policy.organizations.org_a)).toBe(true)
    expect(Object.isFrozen(policy.organizations)).toBe(true)
    expect(selectOutboundRoute(policy, 'constructor')).toEqual({ kind: 'direct' })
  })

  it.each([
    { ...document, schemaVersion: 2 },
    { ...document, organizations: { org_a: { kind: 'gateway' } } },
    { ...document, defaultRoute: { kind: 'gateway', gatewayId: 'a', fallback: true } },
    { ...document, extra: true },
  ])('rejects malformed policy without exposing its content', (input) => {
    expect(() => parseOutboundRoutingConfig(input)).toThrow('INVALID_CONFIGURATION')
  })

  it('bounds serialized configuration and does not expose JSON syntax errors', () => {
    expect(() => parseOutboundJson('sensitive-value')).toThrow('INVALID_CONFIGURATION')
    expect(() => parseOutboundJson(' '.repeat(1_048_577))).toThrow('INVALID_CONFIGURATION')
  })
})
