/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

const { getServiceConfig } = vi.hoisted(() => ({ getServiceConfig: vi.fn() }))
vi.mock('@/lib/oauth/utils', () => ({ getServiceConfigByServiceId: getServiceConfig }))

import { createOracleEpmAuthParameters } from '@/tools/shared/oracle-epm'

describe('createOracleEpmAuthParameters', () => {
  it('returns a fresh deeply frozen bundle tied to the child service id', () => {
    getServiceConfig.mockReturnValue({
      providerId: 'synthetic-provider',
      serviceAccountProviderId: 'oracle-epm-service-account',
    })
    const first = createOracleEpmAuthParameters({ serviceId: 'jira' })
    const second = createOracleEpmAuthParameters({ serviceId: 'jira' })

    expect(first).not.toBe(second)
    expect(first.params).not.toBe(second.params)
    expect(first.oauth.provider).toBe('jira')
    expect(first.oauth).toMatchObject({
      credentialKind: 'service-account',
      authoritativeParams: ['instanceUrl'],
    })
    expect(first.params.oauthCredential.visibility).toBe('user-only')
    expect(first.params.accessToken.visibility).toBe('hidden')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.params.oauthCredential)).toBe(true)
    expect(Object.isFrozen(first.oauth.authoritativeParams)).toBe(true)
  })

  it('fails at declaration time when the service is absent or mapped elsewhere', () => {
    getServiceConfig.mockReturnValue(null)
    expect(() => createOracleEpmAuthParameters({ serviceId: 'jira' })).toThrow('not registered')
    getServiceConfig.mockReturnValue({ serviceAccountProviderId: 'another-provider' })
    expect(() => createOracleEpmAuthParameters({ serviceId: 'jira' })).toThrow('not registered')
  })
})
