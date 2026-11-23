/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { workloadIdentityAudienceSchema } from '@/lib/credentials/workload-identity/audiences'

describe('workloadIdentityAudienceSchema', () => {
  it.each([
    ['databricks', 'sts.amazonaws.com'],
    ['aws', 'api://AzureADTokenExchange'],
    ['microsoft', 'snowflakecomputing.com'],
    ['snowflake', 'sim-databricks'],
    ['google', 'sts.amazonaws.com'],
  ] as const)('refuses another cloud’s default audience for %s', (provider, audience) => {
    expect(workloadIdentityAudienceSchema(provider).safeParse(audience).success).toBe(false)
  })

  it('refuses a Google provider audience outside Google, and allows it for Google', () => {
    const googleAudience =
      '//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/q'
    expect(workloadIdentityAudienceSchema('aws').safeParse(googleAudience).success).toBe(false)
    expect(workloadIdentityAudienceSchema('google').safeParse(googleAudience).success).toBe(true)
  })

  it.each([
    ['has space'],
    [''],
    ['tab\there'],
    ['a'.repeat(256)],
    ['ünicode'],
    ["it's"],
    ['a,b'],
    ['back\\slash'],
    ['$HOME'],
  ])('refuses %j', (audience) => {
    expect(workloadIdentityAudienceSchema('aws').safeParse(audience).success).toBe(false)
  })
})
