/**
 * @vitest-environment node
 */

import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.unmock('@/lib/oauth/credential-service')

import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'

const TENANT = '11111111-2222-3333-4444-555555555555'
const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('a SharePoint selector with a Microsoft app credential', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    resetDbChainMock()
    const row = {
      id: 'app-credential',
      type: 'service_account',
      accountId: null,
      workspaceId: 'ws-1',
      organizationId: null,
      providerId: 'microsoft-app-service-account',
      revokedAt: null,
      encryptedServiceAccountKey: 'ciphertext-selector',
    }
    queueTableRows(credential, [row])
    queueTableRows(credential, [row])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify({
        type: 'microsoft_app_credential_v1',
        config: {
          authType: 'client_secret',
          tenantId: TENANT,
          clientId: CLIENT_ID,
          clientSecret: 'app-secret',
        },
      }),
    })
    fetch.mockReset().mockImplementation(async (_url: string, init: RequestInit) => {
      const scope = new URLSearchParams(String(init.body)).get('scope')
      return jsonResponse({ token_type: 'Bearer', expires_in: 3599, access_token: `at:${scope}` })
    })
    vi.stubGlobal('fetch', fetch)
  })

  it('browses with a Microsoft Graph app-only token', async () => {
    await expect(
      resolveSelectorOAuthAccessToken({
        credential: {
          suppliedId: 'app-credential',
          access: {
            ok: true,
            credentialOwnerUserId: 'user-1',
            resolvedCredentialId: 'app-credential',
          },
        },
        serviceId: 'sharepoint',
        protectedValues: createSelectorProtectedValues(),
      })
    ).resolves.toBe('at:https://graph.microsoft.com/.default')
    expect(fetch).toHaveBeenCalledWith(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      expect.anything()
    )
  })
})
