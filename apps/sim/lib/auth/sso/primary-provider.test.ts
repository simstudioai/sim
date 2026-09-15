/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { markSignInProviders } from '@/lib/auth/sso/primary-provider'

function row(providerId: string, overrides: Record<string, unknown> = {}) {
  return {
    providerId,
    domainKey: 'acme.com',
    domainVerified: true,
    isNamedPrimary: false,
    ...overrides,
  }
}

function primaries(rows: ReturnType<typeof row>[]) {
  return markSignInProviders(rows)
    .filter((provider) => provider.isPrimary)
    .map((provider) => provider.providerId)
}

describe('markSignInProviders', () => {
  it('marks a lone provider as its domain sign-in provider', () => {
    expect(primaries([row('acme-entra')])).toEqual(['acme-entra'])
  })

  it('uses the first verified provider by id until the domain names one', () => {
    expect(primaries([row('acme-entra'), row('acme-okta')])).toEqual(['acme-entra'])
  })

  it('uses the provider the domain names, wherever it sorts', () => {
    expect(primaries([row('acme-entra'), row('acme-okta', { isNamedPrimary: true })])).toEqual([
      'acme-okta',
    ])
  })

  it('never marks an unverified provider, even a named one', () => {
    expect(
      primaries([
        row('acme-entra', { domainVerified: false }),
        row('acme-okta', { domainVerified: false, isNamedPrimary: true }),
      ])
    ).toEqual([])
  })

  it('marks one provider per domain', () => {
    expect(
      primaries([
        row('acme-entra'),
        row('eng-okta', { domainKey: 'eng.acme.com' }),
        row('zeta-okta', { isNamedPrimary: true }),
      ])
    ).toEqual(['eng-okta', 'zeta-okta'])
  })

  it('drops the named-primary column from what it returns', () => {
    const [provider] = markSignInProviders([row('acme-entra')])
    expect(provider).toEqual({
      providerId: 'acme-entra',
      domainKey: 'acme.com',
      domainVerified: true,
      isPrimary: true,
    })
  })
})
