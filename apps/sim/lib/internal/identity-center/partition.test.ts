/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
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
    ['eu-isoe-west-1', 'aws-iso-e'],
    ['eusc-de-east-1', 'aws-eusc'],
  ])('maps %s to the %s partition', (region, partition) => {
    expect(getAwsPartition(region)).toBe(partition)
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
