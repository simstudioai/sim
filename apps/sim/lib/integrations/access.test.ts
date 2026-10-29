import { describe, expect, it } from 'vitest'
import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import {
  createIntegrationAccessPolicy,
  type IntegrationAccess,
  resolveIntegrationAccess,
} from '@/lib/integrations/access'

function accessOf(
  blockType: string,
  policy: {
    groupAllowlist?: string[] | null
    deploymentAllowlist?: string[] | null
    availability?: IntegrationAvailabilityResponse[]
    credentialGroupsEnabled?: boolean
  }
): IntegrationAccess {
  return resolveIntegrationAccess(
    blockType,
    createIntegrationAccessPolicy({
      groupAllowlist: policy.groupAllowlist ?? null,
      deploymentAllowlist: policy.deploymentAllowlist ?? null,
      availability: policy.availability ?? [],
      visibility: null,
      credentialGroupsEnabled: policy.credentialGroupsEnabled ?? true,
    })
  )
}

const AIRTABLE_UNCONFIGURED: IntegrationAvailabilityResponse = {
  type: 'airtable',
  state: 'unavailable',
  oauthAvailable: false,
}

describe('resolveIntegrationAccess', () => {
  it('makes a group restriction requestable only within the deployment allowlist', () => {
    const policy = { groupAllowlist: [], deploymentAllowlist: ['gmail_v2'] }
    expect(accessOf('gmail_v2', policy)).toBe('requestable')
    expect(accessOf('slack_v2', policy)).toBe('denied')
  })

  it('denies, rather than reports unconfigured, an integration the policy restricts', () => {
    const policy = { groupAllowlist: ['slack_v2'], availability: [AIRTABLE_UNCONFIGURED] }
    expect(accessOf('airtable', policy)).toBe('denied')
  })

  it('reports a permitted integration whose OAuth the deployment lacks as unconfigured', () => {
    expect(accessOf('airtable', { availability: [AIRTABLE_UNCONFIGURED] })).toBe('unconfigured')
  })

  it('judges a retired id in either policy as its successor', () => {
    expect(accessOf('slack_v2', { groupAllowlist: ['slack'] })).toBe('available')
    expect(accessOf('slack_v2', { groupAllowlist: [], deploymentAllowlist: ['slack'] })).toBe(
      'requestable'
    )
  })

  it('keeps the universal entry point available under an empty allowlist', () => {
    expect(accessOf('start_trigger', { groupAllowlist: [] })).toBe('available')
  })

  it('denies credential groups where the feature is off, even when unrestricted', () => {
    expect(accessOf('credential_group', { credentialGroupsEnabled: false })).toBe('denied')
  })
})
