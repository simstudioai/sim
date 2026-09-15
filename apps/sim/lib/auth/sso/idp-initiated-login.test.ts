/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

import { resolveIdpInitiatedLoginProvider } from '@/lib/auth/sso/idp-initiated-login'

describe('resolveIdpInitiatedLoginProvider', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('names a verified provider whose issuer opened the link', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { providerId: 'acme-okta', issuer: 'https://acme.okta.test' },
    ])
    await expect(
      resolveIdpInitiatedLoginProvider('acme-okta', 'https://acme.okta.test/')
    ).resolves.toBe('acme-okta')
  })

  it('refuses a link opened by a different issuer', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { providerId: 'acme-okta', issuer: 'https://acme.okta.test' },
    ])
    await expect(
      resolveIdpInitiatedLoginProvider('acme-okta', 'https://attacker.example.test')
    ).resolves.toBeNull()
  })

  it('refuses an unknown or unverified provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [])
    await expect(
      resolveIdpInitiatedLoginProvider('acme-okta', 'https://acme.okta.test')
    ).resolves.toBeNull()
  })
})
