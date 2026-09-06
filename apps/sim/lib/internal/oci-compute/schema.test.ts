import { describe, expect, it } from 'vitest'
import {
  configurationDetailsSchema,
  ociComputeSchemas,
  validateOciComputeMetadata,
} from '@/lib/internal/oci-compute/schema'

const auth = { oauthCredential: 'credential', region: 'us-ashburn-1' }
const launch = {
  ...auth,
  compartmentId: 'compartment',
  availabilityDomain: 'tenant:US-ASHBURN-AD-1',
  shape: 'VM.Standard.E4.Flex',
  createVnicDetails: { subnetId: 'subnet', assignPublicIp: false, nsgIds: [] },
}

describe('OCI Compute input schemas', () => {
  it.each([
    { sourceMode: 'image', imageId: 'image' },
    { sourceMode: 'imageFilter', imageFilter: { compartmentId: 'images', operatingSystem: 'Oracle Linux' } },
    { sourceMode: 'bootVolume', bootVolumeId: 'boot' },
  ])('accepts a discriminated launch source: $sourceMode', (source) => {
    const result = ociComputeSchemas.launch_instance.parse({ ...launch, ...source })
    expect(result.createVnicDetails).toEqual(launch.createVnicDetails)
  })

  it.each([
    { sourceMode: 'image' },
    { sourceMode: 'image', imageId: 'image', bootVolumeId: 'boot' },
    { sourceMode: 'bootVolume', bootVolumeId: 'boot', bootVolumeSizeInGBs: 100 },
    { sourceMode: 'imageFilter', imageFilter: {} },
    { sourceMode: 'image', imageId: 'image', providerRequest: { arbitrary: true } },
    { sourceMode: 'image', imageId: 'image', shapeConfig: { ocpus: 2, vcpus: 4 } },
  ])('rejects incompatible or unrestricted launch inputs', (source) => {
    expect(ociComputeSchemas.launch_instance.safeParse({ ...launch, ...source }).success).toBe(false)
  })

  it('supports provider-default fixed shapes and explicit flexible resources', () => {
    expect(ociComputeSchemas.launch_instance.parse({
      ...launch, sourceMode: 'image', imageId: 'image',
    }).shapeConfig).toBeUndefined()
    expect(ociComputeSchemas.launch_instance.parse({
      ...launch, sourceMode: 'image', imageId: 'image',
      shapeConfig: '{"ocpus":0.5,"memoryInGBs":4}',
    }).shapeConfig).toEqual({ ocpus: 0.5, memoryInGBs: 4 })
  })

  it('allows deferred configuration settings without weakening direct launches', () => {
    const instanceDetails = {
      instanceType: 'compute',
      launchDetails: { sourceDetails: { sourceType: 'image', instanceSourceImageFilterDetails: {} } },
    }
    expect(ociComputeSchemas.create_instance_configuration.parse({
      ...auth, compartmentId: 'compartment', configurationSource: 'NONE', instanceDetails,
    }).instanceDetails).toEqual(instanceDetails)
    expect(ociComputeSchemas.create_instance_configuration.safeParse({
      ...auth, compartmentId: 'compartment', configurationSource: 'INSTANCE',
      instanceId: 'instance', instanceDetails,
    }).success).toBe(false)
    expect(ociComputeSchemas.launch_instance_configuration.parse({
      ...auth, instanceConfigurationId: 'configuration',
    }).instanceDetails).toEqual({ instanceType: 'compute' })
  })

  it('accepts existing volumes and secondary VNICs, and rejects provisioning', () => {
    const details = {
      instanceType: 'compute',
      blockVolumes: [{ volumeId: 'volume', attachDetails: { type: 'paravirtualized', isReadOnly: false } }],
      secondaryVnics: [{ nicIndex: 0, createVnicDetails: { subnetId: 'subnet' } }],
    }
    expect(configurationDetailsSchema.parse(details)).toEqual(details)
    expect(configurationDetailsSchema.safeParse({
      ...details, blockVolumes: [{ createDetails: { sizeInGBs: 50 } }],
    }).success).toBe(false)
  })

  it('uses structured pool subnet placement and preserves zero and empty arrays', () => {
    const input = {
      ...auth, compartmentId: 'compartment', instanceConfigurationId: 'configuration', size: 0,
      placementConfigurations: [{
        availabilityDomain: 'AD', faultDomains: [],
        primaryVnicSubnets: { subnetId: 'subnet', isAssignIpv6Ip: false },
        secondaryVnicSubnets: [{ displayName: 'secondary', subnetId: 'secondary-subnet' }],
      }],
    }
    expect(ociComputeSchemas.create_instance_pool.parse(input)).toEqual(input)
    expect(ociComputeSchemas.create_instance_pool.safeParse({
      ...input, placementConfigurations: [{ availabilityDomain: 'AD', primarySubnetId: 'subnet' }],
    }).success).toBe(false)
  })

  it('preserves empty reservation removal and defaults to avoiding downtime', () => {
    expect(ociComputeSchemas.update_instance.parse({
      ...auth, instanceId: 'instance', capacityReservationId: '', metadata: {},
    })).toMatchObject({
      capacityReservationId: '', metadata: {}, updateOperationConstraint: 'AVOID_DOWNTIME',
    })
    expect(ociComputeSchemas.update_instance_configuration.safeParse({
      ...auth, instanceConfigurationId: 'configuration', instanceDetails: { instanceType: 'compute' },
    }).success).toBe(false)
  })

  it('bounds pages and metadata without silently truncating', () => {
    expect(ociComputeSchemas.list_instances.parse({ ...auth, compartmentId: 'compartment' }).limit).toBe(50)
    expect(ociComputeSchemas.list_instances.safeParse({
      ...auth, compartmentId: 'compartment', limit: 101,
    }).success).toBe(false)
    expect(() => validateOciComputeMetadata({
      metadata: { a: 'x'.repeat(20_000) }, extendedMetadata: { b: 'x'.repeat(20_000) },
    })).toThrow('32,000')
  })
})
