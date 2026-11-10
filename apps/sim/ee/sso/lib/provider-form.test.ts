/**
 * Editing an OIDC provider never echoes its stored secret back. Failure modes: a blank secret on an
 * edit overwriting the working one instead of keeping it, a pasted secret keeping its trailing
 * newline, and a whitespace-only secret passing validation once the admin chose to replace it.
 */
import { describe, expect, it } from 'vitest'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import {
  buildSsoRegistrationBody,
  DEFAULT_SSO_FORM,
  validateSsoProviderForm,
} from '@/ee/sso/lib/provider-form'

const form = (clientSecret: string) => ({
  ...DEFAULT_SSO_FORM,
  providerId: 'okta',
  issuerUrl: 'https://acme.okta.com',
  domain: 'acme.com',
  clientId: 'client-1',
  clientSecret,
})

const secretSent = (clientSecret: string, hasStoredClientSecret: boolean) => {
  const body = buildSsoRegistrationBody(form(clientSecret), 'org-1', hasStoredClientSecret)
  return body.providerType === 'oidc' ? body.clientSecret : undefined
}

describe('the OIDC client secret on save', () => {
  it('keeps the stored secret when an edit leaves the field blank', () => {
    expect(secretSent('', true)).toBe(REDACTED_MARKER)
    expect(secretSent('  \n', true)).toBe(REDACTED_MARKER)
  })

  it('sends a typed secret trimmed, and never the marker for a new provider', () => {
    expect(secretSent('s3cret\n', true)).toBe('s3cret')
    expect(secretSent('', false)).toBe('')
  })

  it('refuses a whitespace-only secret once the admin replaces the stored one', () => {
    const errors = (hasStoredClientSecret: boolean, isReplacingClientSecret: boolean) =>
      validateSsoProviderForm(form('   '), { hasStoredClientSecret, isReplacingClientSecret })
        .clientSecret

    expect(errors(true, true)).not.toEqual([])
    expect(errors(false, false)).not.toEqual([])
    expect(errors(true, false)).toEqual([])
  })
})
