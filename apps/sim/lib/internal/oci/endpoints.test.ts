/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
  getOciRegion,
  OCI_REGION_IDS,
  regionalOciHostname,
  resolveDiscoveredOciEndpoint,
  resolveEffectiveOciRegion,
  resolveStaticOciEndpoint,
} from '@/lib/internal/oci/endpoints'
import { OCI_SERVICE_ID } from '@/lib/oauth/types'

const staticPolicy = createOciStaticEndpointPolicy({
  serviceId: OCI_SERVICE_ID,
  serviceName: 'identity',
})
const discoveryPolicy = createOciDiscoveredEndpointPolicy({
  serviceId: OCI_SERVICE_ID,
  serviceName: 'database',
  responsePolicy: staticPolicy,
  source: { kind: 'json', path: ['endpoint'] },
})

describe('OCI region registry', () => {
  it('resolves every snapshotted region to a known realm domain', () => {
    expect(OCI_REGION_IDS.length).toBeGreaterThan(80)
    for (const id of OCI_REGION_IDS) {
      const region = getOciRegion(id)
      expect(region.id).toBe(id)
      expect(region.realm.id).toMatch(/^oc\d+$/)
      expect(region.realm.domain).toMatch(/^(?:oraclecloud|oraclegovcloud)/)
      expect(regionalOciHostname('identity', region)).toBe(`identity.${id}.${region.realm.domain}`)
    }
  })

  it('normalizes known regions and fails closed for unknown regions', () => {
    expect(getOciRegion('  US-ASHBURN-1 ').id).toBe('us-ashburn-1')
    expect(() => getOciRegion('moon-base-1')).toThrow('not recognized')
    expect(() => getOciRegion('constructor')).toThrow('not recognized')
  })

  it('allows only same-realm region overrides', () => {
    expect(resolveEffectiveOciRegion('us-ashburn-1', 'eu-frankfurt-1').id).toBe('eu-frankfurt-1')
    expect(() => resolveEffectiveOciRegion('us-ashburn-1', 'us-gov-ashburn-1')).toThrow(
      'credential realm'
    )
  })
})

describe('OCI endpoint policies', () => {
  const region = getOciRegion('us-ashburn-1')

  it('freezes declarative policies and derives exact static origins', () => {
    expect(Object.isFrozen(staticPolicy)).toBe(true)
    expect(resolveStaticOciEndpoint(staticPolicy, region)).toMatchObject({
      origin: 'https://identity.us-ashburn-1.oraclecloud.com',
      hostname: 'identity.us-ashburn-1.oraclecloud.com',
      serviceId: OCI_SERVICE_ID,
      serviceName: 'identity',
      provenance: 'static',
    })
  })

  it('accepts discovered resource hosts only beneath the declared service, region, and realm', () => {
    expect(
      resolveDiscoveredOciEndpoint(
        discoveryPolicy,
        region,
        'https://resource.database.us-ashburn-1.oraclecloud.com'
      )
    ).toMatchObject({
      serviceName: 'database',
      provenance: 'authenticated-discovery',
    })
  })

  it.each([
    'http://resource.database.us-ashburn-1.oraclecloud.com',
    'https://resource.database.us-ashburn-1.oraclecloud.com:8443',
    'https://user@resource.database.us-ashburn-1.oraclecloud.com',
    'https://resource.database.us-ashburn-1.oraclecloud.com/path',
    'https://127.0.0.1',
    'https://database.us-ashburn-1.oraclecloud.com',
    'https://resource.database.eu-frankfurt-1.oraclecloud.com',
    'https://resource.database.us-ashburn-1.oraclegovcloud.com',
    'https://resource.database.us-ashburn-1.example.com',
  ])('rejects an origin outside the discovery policy: %s', (origin) => {
    expect(() => resolveDiscoveredOciEndpoint(discoveryPolicy, region, origin)).toThrow()
  })

  it('can explicitly permit the regional service host for authenticated discovery', () => {
    const policy = createOciDiscoveredEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'database',
      responsePolicy: staticPolicy,
      source: { kind: 'header', name: 'Endpoint' },
      allowRegionalHost: true,
    })
    expect(
      resolveDiscoveredOciEndpoint(policy, region, 'https://database.us-ashburn-1.oraclecloud.com')
        .origin
    ).toBe('https://database.us-ashburn-1.oraclecloud.com')
    expect(policy.source).toEqual({ kind: 'header', name: 'endpoint' })
    expect(Object.isFrozen(policy.source)).toBe(true)
  })

  it('rejects malformed policy declarations and forged region mappings', () => {
    expect(() =>
      createOciStaticEndpointPolicy({ serviceId: OCI_SERVICE_ID, serviceName: 'bad.name' })
    ).toThrow('service name')
    expect(() =>
      resolveStaticOciEndpoint(staticPolicy, {
        id: region.id,
        realm: { id: 'oc2', domain: 'oraclegovcloud.com' },
      })
    ).toThrow('known registry')
    expect(() =>
      createOciDiscoveredEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: 'database',
        responsePolicy: createOciStaticEndpointPolicy({
          serviceId: 'slack',
          serviceName: 'identity',
        }),
        source: { kind: 'json', path: ['endpoint'] },
      })
    ).toThrow('same owning service')
  })
})
