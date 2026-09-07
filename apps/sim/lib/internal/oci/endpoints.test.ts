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
  hostnameTemplate: 'regional-oci',
})
const discoveryPolicy = createOciDiscoveredEndpointPolicy({
  serviceId: OCI_SERVICE_ID,
  serviceName: 'database',
  hostnameTemplate: 'regional',
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
      expect(regionalOciHostname('identity', region, 'regional-oci')).toBe(
        `identity.${id}.oci.${region.realm.domain}`
      )
      expect(regionalOciHostname('objectstorage', region, 'regional')).toBe(
        `objectstorage.${id}.${region.realm.domain}`
      )
      expect(regionalOciHostname('functions', region, 'region-first-oci')).toBe(
        `${id}.functions.oci.${region.realm.domain}`
      )
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
  const functionsManagementPolicy = createOciStaticEndpointPolicy({
    serviceId: OCI_SERVICE_ID,
    serviceName: 'functions',
    hostnameTemplate: 'regional-oci',
  })
  const functionsInvocationPolicy = createOciDiscoveredEndpointPolicy({
    serviceId: OCI_SERVICE_ID,
    serviceName: 'functions',
    hostnameTemplate: 'region-first-oci',
    responsePolicy: functionsManagementPolicy,
    source: { kind: 'json', path: ['invokeEndpoint'] },
  })

  it.each(['us-ashburn-1', 'us-gov-ashburn-1'])(
    'supports region-first policies and authenticated Functions discovery in %s',
    (regionId) => {
      const selectedRegion = getOciRegion(regionId)
      const hostname = `${regionId}.functions.oci.${selectedRegion.realm.domain}`
      expect(
        resolveStaticOciEndpoint(
          createOciStaticEndpointPolicy({
            serviceId: OCI_SERVICE_ID,
            serviceName: 'functions',
            hostnameTemplate: 'region-first-oci',
          }),
          selectedRegion
        ).origin
      ).toBe(`https://${hostname}`)
      expect(
        resolveDiscoveredOciEndpoint(
          functionsInvocationPolicy,
          selectedRegion,
          `https://resource.${hostname}`
        )
      ).toMatchObject({
        origin: `https://resource.${hostname}`,
        serviceId: OCI_SERVICE_ID,
        provenance: 'authenticated-discovery',
      })
      expect(Object.isFrozen(functionsInvocationPolicy)).toBe(true)
      expect(functionsInvocationPolicy.hostnameTemplate).toBe('region-first-oci')
      expect(functionsInvocationPolicy.allowRegionalHost).toBe(false)
      expect(
        resolveDiscoveredOciEndpoint(
          createOciDiscoveredEndpointPolicy({
            ...functionsInvocationPolicy,
            allowRegionalHost: true,
          }),
          selectedRegion,
          `https://${hostname}`
        ).hostname
      ).toBe(hostname)
    }
  )

  it.each([
    'https://resource.functions.us-ashburn-1.oci.oraclecloud.com',
    'https://resource.eu-frankfurt-1.functions.oci.oraclecloud.com',
    'https://resource.us-ashburn-1.functions.oci.oraclegovcloud.com',
    'https://resource.us-ashburn-1.database.oci.oraclecloud.com',
    'https://resource.us-ashburn-1.functions.oci.oraclecloud.com.attacker.example',
    'https://resourceus-ashburn-1.functions.oci.oraclecloud.com',
    'https://us-ashburn-1.functions.oci.oraclecloud.com',
    'http://resource.us-ashburn-1.functions.oci.oraclecloud.com',
    'https://resource.us-ashburn-1.functions.oci.oraclecloud.com:8443',
    'https://user:password@resource.us-ashburn-1.functions.oci.oraclecloud.com',
    'https://resource.us-ashburn-1.functions.oci.oraclecloud.com/path',
    'https://resource.us-ashburn-1.functions.oci.oraclecloud.com?query=1',
    'https://resource.us-ashburn-1.functions.oci.oraclecloud.com#fragment',
    'https://127.0.0.1',
  ])('rejects invalid Functions invocation origins: %s', (origin) => {
    expect(() => resolveDiscoveredOciEndpoint(functionsInvocationPolicy, region, origin)).toThrow()
  })

  it('freezes declarative policies and derives exact static origins', () => {
    expect(Object.isFrozen(staticPolicy)).toBe(true)
    const endpoint = resolveStaticOciEndpoint(staticPolicy, region)
    expect(endpoint).toMatchObject({
      origin: 'https://identity.us-ashburn-1.oci.oraclecloud.com',
      hostname: 'identity.us-ashburn-1.oci.oraclecloud.com',
      serviceId: OCI_SERVICE_ID,
      serviceName: 'identity',
      provenance: 'static',
    })
    expect(Object.isFrozen(endpoint)).toBe(true)
    expect(Object.isFrozen(endpoint.region)).toBe(true)
    expect(Object.isFrozen(endpoint.region.realm)).toBe(true)
    expect(Reflect.set(endpoint, 'origin', 'https://attacker.example')).toBe(false)
    expect(Reflect.set(endpoint.region, 'id', 'attacker-region-1')).toBe(false)
    expect(endpoint.origin).toBe('https://identity.us-ashburn-1.oci.oraclecloud.com')
    expect(endpoint.region.id).toBe('us-ashburn-1')
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

  it.each(['secrets.vaults', 'ingestion.logging', 'identity', 'telemetry-ingestion', 'a', 'a0'])(
    'constructs exact regional hosts for the service prefix %s',
    (serviceName) => {
      const policy = createOciStaticEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName,
        hostnameTemplate: 'regional-oci',
      })
      expect(Object.isFrozen(policy)).toBe(true)
      expect(policy.serviceName).toBe(serviceName)
      for (const regionId of ['us-ashburn-1', 'us-gov-ashburn-1']) {
        const selectedRegion = getOciRegion(regionId)
        expect(resolveStaticOciEndpoint(policy, selectedRegion).origin).toBe(
          `https://${serviceName}.${regionId}.oci.${selectedRegion.realm.domain}`
        )
      }
    }
  )

  it('preserves multi-label ownership in authenticated discovery', () => {
    const policy = createOciDiscoveredEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'secrets.vaults',
      hostnameTemplate: 'regional-oci',
      responsePolicy: staticPolicy,
      source: { kind: 'json', path: ['endpoint'] },
    })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(
      resolveDiscoveredOciEndpoint(
        policy,
        region,
        'https://resource.secrets.vaults.us-ashburn-1.oci.oraclecloud.com'
      ).serviceName
    ).toBe('secrets.vaults')
    for (const origin of [
      'https://resource.vaults.us-ashburn-1.oci.oraclecloud.com',
      'https://resource.secrets.vaults.eu-frankfurt-1.oci.oraclecloud.com',
      'https://resource.secrets.vaults.us-ashburn-1.oci.oraclegovcloud.com',
      'https://resource.secrets.vaults.us-ashburn-1.oci.oraclecloud.com.attacker.example',
    ]) {
      expect(() => resolveDiscoveredOciEndpoint(policy, region, origin)).toThrow()
    }
  })

  it.each([
    '',
    '.',
    '.identity',
    'identity.',
    'secrets..vaults',
    '-identity',
    'identity-',
    '1identity',
    'Identity',
    'identity_service',
    'identity service',
    'identity\n',
    'identity\r',
    'identity\t',
    'identity\0',
    'identité',
    'https://identity',
    'identity:443',
    'identity/path',
    'identity\\path',
    '*.identity',
    'identity?x=1',
    'identity#fragment',
    'identity@host',
    'a'.repeat(64),
    null,
    undefined,
    42,
    ['identity'],
  ])('rejects malformed service prefixes in both policy factories: %j', (serviceName) => {
    expect(() =>
      createOciStaticEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: serviceName as never,
        hostnameTemplate: 'regional',
      })
    ).toThrow('service name')
    expect(() =>
      createOciDiscoveredEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: serviceName as never,
        hostnameTemplate: 'regional',
        responsePolicy: staticPolicy,
        source: { kind: 'json', path: ['endpoint'] },
      })
    ).toThrow('service name')
  })

  it('bounds labels, prefixes, and complete hostnames', () => {
    const label = 'a'.repeat(63)
    expect(regionalOciHostname(label, region, 'regional')).toBe(
      `${label}.${region.id}.${region.realm.domain}`
    )
    const prefix = [label, label, label, 'b'.repeat(61)].join('.')
    expect(prefix.length).toBe(253)
    const policy = createOciStaticEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: prefix,
      hostnameTemplate: 'regional',
    })
    expect(policy.serviceName).toBe(prefix)
    expect(() =>
      createOciStaticEndpointPolicy({
        ...policy,
        serviceName: `${prefix}b`,
      })
    ).toThrow('service name')
    expect(() => resolveStaticOciEndpoint(policy, region)).toThrow('hostname')

    const suffix = `.${region.id}.oci.${region.realm.domain}`
    const boundedPrefix = [label, label, label, 'b'.repeat(253 - suffix.length - 192)].join('.')
    const boundedPolicy = createOciStaticEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: boundedPrefix,
      hostnameTemplate: 'regional-oci',
    })
    expect(resolveStaticOciEndpoint(boundedPolicy, region).hostname.length).toBe(253)
    expect(() => regionalOciHostname(`${boundedPrefix}b`, region, 'regional-oci')).toThrow(
      'hostname'
    )
    const boundedDiscovery = createOciDiscoveredEndpointPolicy({
      ...boundedPolicy,
      responsePolicy: staticPolicy,
      source: { kind: 'json', path: ['endpoint'] },
    })
    expect(() =>
      resolveDiscoveredOciEndpoint(boundedDiscovery, region, `https://a.${boundedPrefix}${suffix}`)
    ).toThrow()
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
      hostnameTemplate: 'regional',
      responsePolicy: staticPolicy,
      source: { kind: 'header', name: 'location' },
      allowRegionalHost: true,
    })
    expect(
      resolveDiscoveredOciEndpoint(policy, region, 'https://database.us-ashburn-1.oraclecloud.com')
        .origin
    ).toBe('https://database.us-ashburn-1.oraclecloud.com')
    expect(policy.source).toEqual({ kind: 'header', name: 'location' })
    expect(Object.isFrozen(policy.source)).toBe(true)
  })

  it('rejects malformed policy declarations and forged region mappings', () => {
    expect(() =>
      createOciStaticEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: 'bad..name',
        hostnameTemplate: 'regional',
      })
    ).toThrow('service name')
    expect(() =>
      createOciStaticEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: 'identity',
        hostnameTemplate: 'arbitrary' as never,
      })
    ).toThrow('hostname template')
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
        hostnameTemplate: 'regional',
        responsePolicy: createOciStaticEndpointPolicy({
          serviceId: 'slack',
          serviceName: 'identity',
          hostnameTemplate: 'regional-oci',
        }),
        source: { kind: 'json', path: ['endpoint'] },
      })
    ).toThrow('same owning service')
    expect(() =>
      createOciDiscoveredEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: 'database',
        hostnameTemplate: 'regional',
        responsePolicy: staticPolicy,
        source: { kind: 'header', name: 'x-custom-endpoint' } as never,
      })
    ).toThrow('safe Location')
  })
})
