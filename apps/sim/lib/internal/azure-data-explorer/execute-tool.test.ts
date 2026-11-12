/**
 * @vitest-environment node
 */
import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { executeAzureDataExplorerTool } from '@/lib/internal/azure-data-explorer/execute-tool'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

const { mockSecureFetchWithValidation: secureFetch } = inputValidationMockFns

const TENANT = '11111111-2222-3333-4444-555555555555'
const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLUSTER = 'https://mycluster.eastus.kusto.windows.net'

const QUERY_RESULT = {
  Tables: [
    {
      TableName: 'Table_0',
      Columns: [{ ColumnName: 'Test', DataType: 'String', ColumnType: 'string' }],
      Rows: [['Hello']],
    },
  ],
}

let secretVersion = 0

/** Stores a fresh secret version each time, so no test reuses another's cached token. */
function storeAppCredential(config: Record<string, unknown> = {}) {
  secretVersion += 1
  resetDbChainMock()
  queueTableRows(credential, [
    {
      workspaceId: 'ws-1',
      organizationId: null,
      type: 'service_account',
      providerId: 'microsoft-app-service-account',
      revokedAt: null,
      encryptedServiceAccountKey: `ciphertext-${secretVersion}`,
    },
  ])
  encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
    decrypted: JSON.stringify({
      type: 'microsoft_app_credential_v1',
      config: {
        authType: 'client_secret',
        tenantId: TENANT,
        clientId: CLIENT_ID,
        clientSecret: 'app-secret',
        ...config,
      },
    }),
  })
}

function run(
  input: Record<string, unknown>,
  authorized?: InternalToolOperationContext['authorizedServiceAccountCredential']
) {
  return executeAzureDataExplorerTool({
    toolId: 'azure_data_explorer_query',
    input: { endpoint: 'query', database: 'Samples', csl: 'print Test="Hello"', ...input },
    headers: new Headers(),
    requestId: 'request-1',
    context: {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      ...(authorized ? { authorizedServiceAccountCredential: authorized } : {}),
    },
  })
}

describe('running an Azure Data Explorer tool', () => {
  const entra = vi.fn()

  beforeEach(() => {
    secureFetch.mockReset()
    encryptionMockFns.mockDecryptSecret.mockReset()
    entra.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
      const scope = new URLSearchParams(String(init.body)).get('scope')
      return jsonResponse({ access_token: `at:${url}|${scope}`, expires_in: 3599 })
    })
    vi.stubGlobal('fetch', entra)
  })

  describe('as an authorized Microsoft app credential', () => {
    const authorized = { credentialId: 'cred-adx', service: 'azure-data-explorer' }

    it('needs no inline secret and calls the cluster with a token minted for it', async () => {
      storeAppCredential()
      secureFetch.mockResolvedValueOnce(jsonResponse(QUERY_RESULT))

      const response = await run({ clusterUri: `${CLUSTER}/` }, authorized)

      expect(response.status).toBe(200)
      expect(entra).toHaveBeenCalledTimes(1)
      expect(entra.mock.calls[0][0]).toBe(
        `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
      )
      expect(Object.fromEntries(new URLSearchParams(String(entra.mock.calls[0][1].body)))).toEqual({
        client_id: CLIENT_ID,
        client_secret: 'app-secret',
        grant_type: 'client_credentials',
        scope: `${CLUSTER}/.default`,
      })
      expect(secureFetch).toHaveBeenCalledTimes(1)
      expect(secureFetch.mock.calls[0][0]).toBe(`${CLUSTER}/v1/rest/query`)
      expect(secureFetch.mock.calls[0][1].headers.Authorization).toBe(
        `Bearer at:https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token|${CLUSTER}/.default`
      )
    })

    it('ignores inline sign-in fields, so the credential decides who the request runs as', async () => {
      storeAppCredential()
      secureFetch.mockResolvedValueOnce(jsonResponse(QUERY_RESULT))

      const response = await run(
        {
          clusterUri: CLUSTER,
          tenantId: 'other-tenant',
          clientId: 'other-client',
          clientSecret: 'other-secret',
        },
        authorized
      )

      expect(response.status).toBe(200)
      expect(String(entra.mock.calls[0][0])).toContain(TENANT)
      expect(String(entra.mock.calls[0][1].body)).not.toContain('other-secret')
    })

    it('takes the token audience from the host of a resource override, without its path', async () => {
      storeAppCredential()
      secureFetch.mockResolvedValueOnce(jsonResponse(QUERY_RESULT))
      const audience = 'https://help.kusto.windows.net'

      await run({ clusterUri: CLUSTER, resource: `${audience}/some/path` }, authorized)

      expect(new URLSearchParams(String(entra.mock.calls[0][1].body)).get('scope')).toBe(
        `${audience}/.default`
      )
    })

    it('refuses a cluster outside the credential’s cloud before any request', async () => {
      storeAppCredential({ cloud: 'usgov' })

      const response = await run({ clusterUri: CLUSTER }, authorized)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.stringMatching(/different Microsoft cloud/),
      })
      expect(entra).not.toHaveBeenCalled()
      expect(secureFetch).not.toHaveBeenCalled()
    })

    it('refuses a credential that belongs to another workspace than the run, before decrypting', async () => {
      storeAppCredential()

      const response = await executeAzureDataExplorerTool({
        toolId: 'azure_data_explorer_query',
        input: { endpoint: 'query', database: 'Samples', csl: 'print 1', clusterUri: CLUSTER },
        headers: new Headers(),
        requestId: 'request-1',
        context: {
          workflowId: 'wf-1',
          workspaceId: 'ws-2',
          userId: 'user-1',
          authorizedServiceAccountCredential: authorized,
        },
      })

      expect(response.status).toBe(403)
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
      expect(entra).not.toHaveBeenCalled()
      expect(secureFetch).not.toHaveBeenCalled()
    })

    it('asks for a reconnect when Entra rejects the app, without echoing Entra’s detail', async () => {
      storeAppCredential()
      entra.mockResolvedValueOnce(
        jsonResponse(
          { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret' },
          { status: 401 }
        )
      )

      const response = await run({ clusterUri: CLUSTER }, authorized)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toMatch(/reconnect/)
      expect(body.error).not.toMatch(/AADSTS/)
      expect(secureFetch).not.toHaveBeenCalled()
    })

    it('signs in at the national cloud of a credential that matches the cluster', async () => {
      storeAppCredential({ cloud: 'usgov_dod' })
      secureFetch.mockResolvedValueOnce(jsonResponse(QUERY_RESULT))
      const govCluster = 'https://mycluster.usgovvirginia.kusto.usgovcloudapi.net'

      const response = await run({ clusterUri: govCluster }, authorized)

      expect(response.status).toBe(200)
      expect(entra.mock.calls[0][0]).toBe(
        `https://login.microsoftonline.us/${TENANT}/oauth2/v2.0/token`
      )
    })

    it('refuses a resource override in another cloud than the cluster before decrypting', async () => {
      storeAppCredential()

      const response = await run(
        {
          clusterUri: CLUSTER,
          resource: 'https://mycluster.usgovvirginia.kusto.usgovcloudapi.net',
        },
        authorized
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringMatching(/same Microsoft cloud/),
      })
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
      expect(entra).not.toHaveBeenCalled()
      expect(secureFetch).not.toHaveBeenCalled()
    })

    it('refuses a host outside the Kusto allowlist without minting', async () => {
      const response = await run({ clusterUri: 'https://evil.example.com' }, authorized)

      expect(response.status).toBe(400)
      expect(entra).not.toHaveBeenCalled()
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
    })
  })

  it('still requires the inline client secret when no credential was authorized', async () => {
    const response = await run({ clusterUri: CLUSTER, tenantId: TENANT, clientId: CLIENT_ID })

    expect(response.status).toBe(400)
    expect(entra).not.toHaveBeenCalled()
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('keeps the inline client secret path for a credential authorized for another service', async () => {
    const response = await run(
      { clusterUri: CLUSTER, tenantId: TENANT, clientId: CLIENT_ID },
      { credentialId: 'cred-aws', service: 'aws' }
    )

    expect(response.status).toBe(400)
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})
