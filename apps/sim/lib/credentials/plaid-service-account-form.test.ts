/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createCredentialBodySchema } from '@/lib/api/contracts/credentials'
import { v2CreateServiceAccountCredentialBodySchema } from '@/lib/api/contracts/v2/credentials'
import {
  PLAID_SERVICE_ACCOUNT_ENVIRONMENTS,
  PLAID_SERVICE_ACCOUNT_FORM,
  PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS,
} from '@/lib/credentials/plaid-service-account-form'
import { getServiceAccountConnectNoun } from '@/lib/credentials/service-account-provider-ids'
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_PLAID_CREATE_BODY: Record<string, unknown> = {
  workspaceId: WORKSPACE_ID,
  type: 'service_account',
  providerId: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
  environment: 'sandbox',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessToken: 'access-sandbox-item',
}

describe('Plaid service-account form metadata', () => {
  it('declares the complete credential bundle in display order', () => {
    expect(PLAID_SERVICE_ACCOUNT_FORM.fields).toMatchObject([
      { id: 'environment', secret: false, options: expect.any(Array) },
      { id: 'clientId', secret: true },
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

  it('drives connect terminology', () => {
    expect(getServiceAccountConnectNoun(PLAID_SERVICE_ACCOUNT_PROVIDER_ID)).toBe(
      PLAID_SERVICE_ACCOUNT_FORM.connectNoun
    )
    expect(PLAID_SERVICE_ACCOUNT_FORM.catalogDescription).toBe(
      'Connect one workspace credential for a Plaid Item using application credentials and an Item access token.'
    )
  })

  it('accepts the complete Plaid bundle through the internal credential contract', () => {
    expect(createCredentialBodySchema.safeParse(VALID_PLAID_CREATE_BODY).success).toBe(true)
  })

  it.each(PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS)(
    'rejects a missing %s through the internal credential contract',
    (field) => {
      const body = { ...VALID_PLAID_CREATE_BODY }
      delete body[field]

      const result = createCredentialBodySchema.safeParse(body)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: [field],
            message: `${field} is required for ${PLAID_SERVICE_ACCOUNT_PROVIDER_ID} credentials`,
          })
        )
      }
    }
  )

  it('keeps Plaid unavailable through the public v2 creation contract', () => {
    const result = v2CreateServiceAccountCredentialBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      type: 'service_account',
      providerId: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
      credentials: JSON.stringify({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['providerId'],
          message: `Unknown service-account provider: ${PLAID_SERVICE_ACCOUNT_PROVIDER_ID}`,
        })
      )
    }
  })
})
