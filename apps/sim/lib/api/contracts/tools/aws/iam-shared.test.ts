/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { iamRegionSchema } from '@/lib/api/contracts/tools/aws/iam-shared'

describe('iamRegionSchema', () => {
  it.each([
    'us-east-1',
    'eu-west-2',
    'ap-southeast-4',
    'sa-east-1',
    'il-central-1',
    'mx-central-1',
    'ca-west-1',
  ])('accepts the commercial region %s', (region) => {
    expect(iamRegionSchema.safeParse(region).success).toBe(true)
  })

  it.each(['us-gov-east-1', 'us-gov-west-1', 'cn-north-1', 'cn-northwest-1'])(
    'accepts the partitioned region %s',
    (region) => {
      expect(iamRegionSchema.safeParse(region).success).toBe(true)
    }
  )

  it.each(['us-iso-east-1', 'us-isob-east-1', 'eu-isoe-west-1', 'eusc-de-east-1'])(
    'accepts the isolated region %s',
    (region) => {
      expect(iamRegionSchema.safeParse(region).success).toBe(true)
    }
  )

  /**
   * The pinned `@aws-sdk/client-iam` endpoint ruleset maps the ISO-F partition to
   * `https://iam.us-isof-south-1.csp.hci.ic.gov`, so IAM demonstrably exists there.
   */
  it.each(['us-isof-south-1', 'us-isof-east-1'])('accepts the ISO-F region %s', (region) => {
    expect(iamRegionSchema.safeParse(region).success).toBe(true)
  })

  it('rejects an empty region', () => {
    expect(iamRegionSchema.safeParse('').success).toBe(false)
  })

  it.each([
    'us_east_1',
    'US-EAST-1',
    'us east 1',
    'useast1',
    'us-east-1.evil.example.com',
    'us-east-1/../admin',
    'us-east-1:443',
    'user@us-east-1',
    'us-east-1\nx-injected: 1',
    '-us-east-1',
    'us-east-1-',
  ])('rejects the host-unsafe or malformed value %j', (region) => {
    expect(iamRegionSchema.safeParse(region).success).toBe(false)
  })

  it('rejects a region longer than 64 characters', () => {
    expect(iamRegionSchema.safeParse(`us-${'a'.repeat(70)}-1`).success).toBe(false)
  })
})
