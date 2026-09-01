/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  checkSapExternalUrlSafety,
  sapS4HanaOperationInputSchema,
} from '@/lib/internal/sap-s4hana/schema'

describe('SAP S/4HANA operation schema', () => {
  it('applies public-cloud auth defaults', () => {
    expect(
      sapS4HanaOperationInputSchema.parse({
        subdomain: 'example',
        region: 'us30',
        clientId: 'client',
        clientSecret: 'secret',
        service: 'API_BUSINESS_PARTNER',
        path: '/A_BusinessPartner',
      })
    ).toMatchObject({
      deploymentType: 'cloud_public',
      authType: 'oauth_client_credentials',
      method: 'GET',
    })
  })

  it('accepts private-cloud Basic auth only with a public HTTPS base URL', () => {
    expect(
      sapS4HanaOperationInputSchema.safeParse({
        deploymentType: 'cloud_private',
        authType: 'basic',
        baseUrl: 'https://sap.example.com',
        username: 'user',
        password: 'password',
        service: 'API_PRODUCT_SRV',
        path: '/A_Product',
      }).success
    ).toBe(true)

    const rejected = sapS4HanaOperationInputSchema.safeParse({
      deploymentType: 'cloud_private',
      authType: 'basic',
      baseUrl: 'https://127.0.0.1',
      username: 'user',
      password: 'password',
      service: 'API_PRODUCT_SRV',
      path: '/A_Product',
    })
    expect(rejected.success).toBe(false)
  })

  it('rejects path traversal and query injection in the service path', () => {
    const result = sapS4HanaOperationInputSchema.safeParse({
      subdomain: 'example',
      region: 'us30',
      clientId: 'client',
      clientSecret: 'secret',
      service: 'API_BUSINESS_PARTNER',
      path: '/../admin?$top=1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-HTTPS and private external URLs', () => {
    expect(checkSapExternalUrlSafety('http://sap.example.com', 'baseUrl')).toEqual({
      ok: false,
      message: 'baseUrl must use https://',
    })
    expect(checkSapExternalUrlSafety('https://169.254.169.254', 'baseUrl')).toEqual({
      ok: false,
      message: 'baseUrl host is not allowed',
    })
  })
})
