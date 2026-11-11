import { describe, expect, it } from 'vitest'
import { getMissingServiceAccountFields } from '@/lib/credentials/service-account-fields'

describe('required fields for a service-account create', () => {
  it('accepts a keyless Snowflake configuration in place of the token and host', () => {
    expect(
      getMissingServiceAccountFields('snowflake-service-account', { serviceAccountJson: '{}' })
    ).toEqual([])
  })

  it('still asks a Snowflake create with neither mode for the token and host', () => {
    expect(getMissingServiceAccountFields('snowflake-service-account', {})).toEqual(
      expect.arrayContaining(['apiToken', 'domain'])
    )
  })

  it('does not let a JSON configuration stand in for another token provider’s token', () => {
    expect(
      getMissingServiceAccountFields('hubspot-service-account', { serviceAccountJson: '{}' })
    ).toEqual(['apiToken'])
  })
})
