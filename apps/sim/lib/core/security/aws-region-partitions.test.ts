import { describe, expect, it } from 'vitest'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ok = [
  'us-east-1',
  'eu-west-2',
  'us-gov-west-1',
  'cn-northwest-1',
  'us-iso-east-1',
  'us-isob-east-1',
  'eu-isoe-west-1',
  'eusc-de-east-1',
  'us-isof-south-1',
  'us-isof-east-1',
  'ap-southeast-4',
  'me-central-1',
]
const bad = [
  '',
  'us-east',
  'US-EAST-1',
  'us-east-1.evil.com',
  'us-east-1/x',
  'us-isog-east-1',
  '../us-east-1',
  'us-east-1:80',
]
describe('validateAwsRegion partitions', () => {
  for (const r of ok) it(`accepts ${r}`, () => expect(validateAwsRegion(r).isValid).toBe(true))
  for (const r of bad)
    it(`rejects ${JSON.stringify(r)}`, () => expect(validateAwsRegion(r).isValid).toBe(false))
})
