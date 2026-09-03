/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getOciRegion,
  isObjectStorageOciHostname,
  OCI_REGION_IDS,
  objectStorageOciDestination,
  objectStorageOciHostname,
  resolveEffectiveOciRegion,
  validateOciDestination,
} from '@/lib/internal/oci/endpoints'

describe('OCI region registry', () => {
  it('resolves every snapshotted entry to a consistent realm and domain', () => {
    expect(OCI_REGION_IDS.length).toBeGreaterThan(80)
    for (const id of OCI_REGION_IDS) {
      const region = getOciRegion(id)
      expect(region.id).toBe(id)
      expect(region.realm.id).toMatch(/^oc\d+$/)
      expect(region.realm.domain).toMatch(/^(?:oraclecloud|oraclegovcloud)/)
      expect(objectStorageOciHostname(region)).toBe(`objectstorage.${id}.${region.realm.domain}`)
    }
  })

  it('normalizes known regions and fails closed for unknown regions', () => {
    expect(getOciRegion('  US-ASHBURN-1 ').id).toBe('us-ashburn-1')
    expect(() => getOciRegion('moon-base-1')).toThrow('not recognized')
  })

  it('allows only same-realm effective-region overrides', () => {
    expect(resolveEffectiveOciRegion('us-ashburn-1').id).toBe('us-ashburn-1')
    expect(resolveEffectiveOciRegion('us-ashburn-1', 'eu-frankfurt-1').id).toBe('eu-frankfurt-1')
    expect(() => resolveEffectiveOciRegion('us-ashburn-1', 'us-gov-ashburn-1')).toThrow(
      'credential realm'
    )
    expect(() => resolveEffectiveOciRegion('us-ashburn-1', 'unknown-1')).toThrow('not recognized')
  })
})

describe('validateOciDestination', () => {
  const region = getOciRegion('us-ashburn-1')
  const origin = 'https://objectstorage.us-ashburn-1.oraclecloud.com'

  it.each(['static', 'authenticated-discovery'] as const)(
    'brands a service-owned %s destination',
    (provenance) => {
      expect(objectStorageOciDestination(region, provenance)).toMatchObject({
        origin,
        hostname: 'objectstorage.us-ashburn-1.oraclecloud.com',
        service: 'objectstorage',
        region,
        provenance,
      })
    }
  )

  it.each([
    'http://objectstorage.us-ashburn-1.oraclecloud.com',
    'https://objectstorage.us-ashburn-1.oraclecloud.com:8443',
    'https://user@objectstorage.us-ashburn-1.oraclecloud.com',
    'https://objectstorage.us-ashburn-1.oraclecloud.com/path',
    'https://objectstorage.us-ashburn-1.oraclecloud.com?query=1',
    'https://objectstorage.us-ashburn-1.oraclecloud.com#fragment',
    'https://127.0.0.1',
  ])('rejects a non-origin destination: %s', (candidate) => {
    expect(() =>
      validateOciDestination({
        origin: candidate,
        service: 'objectstorage',
        region,
        provenance: 'static',
        isServiceHostname: isObjectStorageOciHostname,
      })
    ).toThrow()
  })

  it.each([
    'https://identity.us-ashburn-1.oraclecloud.com',
    'https://objectstorage.eu-frankfurt-1.oraclecloud.com',
    'https://objectstorage.us-ashburn-1.oraclegovcloud.com',
    'https://objectstorage.us-ashburn-1.example.com',
  ])('rejects a hostname outside the service and effective region: %s', (candidate) => {
    expect(() =>
      validateOciDestination({
        origin: candidate,
        service: 'objectstorage',
        region,
        provenance: 'authenticated-discovery',
        isServiceHostname: isObjectStorageOciHostname,
      })
    ).toThrow('not owned')
  })

  it('binds the hostname predicate to its service constant', () => {
    expect(() =>
      validateOciDestination({
        origin,
        service: 'identity',
        region,
        provenance: 'static',
        isServiceHostname: isObjectStorageOciHostname,
      })
    ).toThrow('not owned')
  })

  it('rejects a forged region-to-realm association', () => {
    expect(() =>
      validateOciDestination({
        origin,
        service: 'objectstorage',
        region: { id: region.id, realm: { id: 'oc2', domain: 'oraclegovcloud.com' } },
        provenance: 'static',
        isServiceHostname: isObjectStorageOciHostname,
      })
    ).toThrow('known registry')
  })
})
