import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

import { isIdpInitiatedLoginAllowed } from '@/lib/auth/sso/idp-initiated-login'

function queueProvider(issuer: string) {
  queueTableRows(schemaMock.ssoProvider, [{ issuer }])
}

describe('isIdpInitiatedLoginAllowed', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    ['the issuer it is configured with', 'https://acme.okta.test', 'https://acme.okta.test'],
    ['that issuer with a trailing slash', 'https://acme.okta.test', 'https://acme.okta.test/'],
    [
      'the organization URL of its custom authorization server',
      'https://acme.okta.test/oauth2/default',
      'https://acme.okta.test',
    ],
  ])('allows a provider opened by %s', async (_label, configured, opened) => {
    queueProvider(configured)
    await expect(isIdpInitiatedLoginAllowed('acme-okta', opened)).resolves.toBe(true)
  })

  it.each([
    ['another identity provider', 'https://attacker.example.test'],
    ['a value that is not a URL', 'not-a-url'],
  ])('refuses a link opened by %s', async (_label, opened) => {
    queueProvider('https://acme.okta.test')
    await expect(isIdpInitiatedLoginAllowed('acme-okta', opened)).resolves.toBe(false)
  })

  it('refuses a provider that is unknown, unverified, or SAML', async () => {
    queueTableRows(schemaMock.ssoProvider, [])
    await expect(isIdpInitiatedLoginAllowed('acme-okta', 'https://acme.okta.test')).resolves.toBe(
      false
    )
  })
})
