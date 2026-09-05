/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import {
  getAwsPartition,
  resolveOrganizationsRegion,
} from '@/lib/internal/identity-center/partition'

describe('getAwsPartition', () => {
  it.each([
    ['us-east-1', 'aws'],
    ['eu-west-2', 'aws'],
    ['ap-southeast-1', 'aws'],
    ['us-gov-west-1', 'aws-us-gov'],
    ['us-gov-east-1', 'aws-us-gov'],
    ['cn-north-1', 'aws-cn'],
    ['cn-northwest-1', 'aws-cn'],
    ['us-iso-east-1', 'aws-iso'],
    ['us-isob-east-1', 'aws-iso-b'],
    ['us-isof-east-1', 'aws-iso-f'],
    ['us-isof-south-1', 'aws-iso-f'],
    ['eu-isoe-west-1', 'aws-iso-e'],
    ['eusc-de-east-1', 'aws-eusc'],
  ])('maps %s to the %s partition', (region, partition) => {
    expect(getAwsPartition(region)).toBe(partition)
  })

  /**
   * `getAwsPartition` falls through to the commercial `aws` partition for any region
   * it does not recognize, so widening `validateAwsRegion` without adding the matching
   * rule here silently routes an isolated-partition caller to a commercial endpoint.
   * This couples the two so that drift fails the suite instead of shipping.
   */
  it('claims a non-commercial partition for every isolated region the shared validator admits', () => {
    const isolatedRegions = [
      'us-gov-west-1',
      'us-gov-east-1',
      'cn-north-1',
      'cn-northwest-1',
      'us-iso-east-1',
      'us-isob-east-1',
      'us-isof-east-1',
      'us-isof-south-1',
      'eu-isoe-west-1',
      'eusc-de-east-1',
    ]

    for (const region of isolatedRegions) {
      expect(validateAwsRegion(region).isValid).toBe(true)
      expect(getAwsPartition(region)).not.toBe('aws')
    }
  })
})

describe('resolveOrganizationsRegion', () => {
  it('signs commercial regions against the us-east-1 Organizations endpoint', () => {
    expect(resolveOrganizationsRegion('us-east-1')).toBe('us-east-1')
    expect(resolveOrganizationsRegion('eu-west-2')).toBe('us-east-1')
    expect(resolveOrganizationsRegion('ap-northeast-1')).toBe('us-east-1')
  })

  it('never sends a GovCloud caller to a commercial endpoint', () => {
    for (const region of ['us-gov-west-1', 'us-gov-east-1']) {
      const resolved = resolveOrganizationsRegion(region)
      expect(resolved).not.toBe('us-east-1')
      expect(resolved).toBe('us-gov-west-1')
    }
  })

  it('never sends a China caller to a commercial endpoint', () => {
    for (const region of ['cn-north-1', 'cn-northwest-1']) {
      const resolved = resolveOrganizationsRegion(region)
      expect(resolved).not.toBe('us-east-1')
      expect(resolved).toBe('cn-northwest-1')
    }
  })

  it.each(['us-iso-east-1', 'us-isob-east-1', 'eu-isoe-west-1', 'eusc-de-east-1'])(
    'throws rather than guessing an endpoint for %s',
    (region) => {
      expect(() => resolveOrganizationsRegion(region)).toThrow(/does not publish/)
    }
  )
})
