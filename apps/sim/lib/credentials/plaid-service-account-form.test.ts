/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  PLAID_SERVICE_ACCOUNT_ENVIRONMENTS,
  PLAID_SERVICE_ACCOUNT_FORM,
  PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS,
} from '@/lib/credentials/plaid-service-account-form'
import { getServiceAccountRequiredFields } from '@/lib/credentials/service-account-fields'
import { getServiceAccountConnectNoun } from '@/lib/credentials/service-account-provider-ids'
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

describe('Plaid service-account form metadata', () => {
  it('declares the complete credential bundle in display order', () => {
    expect(PLAID_SERVICE_ACCOUNT_FORM.fields).toMatchObject([
      { id: 'environment', secret: false, options: expect.any(Array) },
      { id: 'clientId', secret: false },
      { id: 'clientSecret', secret: true },
      { id: 'accessToken', secret: true },
    ])
    expect(PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS).toEqual([
      'environment',
      'clientId',
      'clientSecret',
      'accessToken',
    ])
    expect(PLAID_SERVICE_ACCOUNT_FORM.fields[0]?.options).toEqual([
      { value: 'production', label: 'Production' },
      { value: 'sandbox', label: 'Sandbox' },
    ])
    expect(PLAID_SERVICE_ACCOUNT_ENVIRONMENTS).toEqual(['production', 'sandbox'])
  })

  it('drives required-field validation and connect terminology', () => {
    expect(getServiceAccountRequiredFields(PLAID_SERVICE_ACCOUNT_PROVIDER_ID)).toEqual(
      PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS
    )
    expect(getServiceAccountConnectNoun(PLAID_SERVICE_ACCOUNT_PROVIDER_ID)).toBe(
      PLAID_SERVICE_ACCOUNT_FORM.connectNoun
    )
    expect(PLAID_SERVICE_ACCOUNT_FORM.catalogDescription).toBe(
      'Connect one Plaid Item with your Plaid application credentials and Item access token.'
    )
  })
})
