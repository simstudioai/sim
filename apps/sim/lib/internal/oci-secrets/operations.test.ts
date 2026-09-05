/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OciAuthenticatedResponse, OciClient } from '@/lib/internal/oci/client.server'
import type { OciPreparedEndpoint } from '@/lib/internal/oci/endpoints'
import { ociSecretsInputSchema } from '@/lib/internal/oci-secrets/input'
import { executeOciSecretsOperation } from '@/lib/internal/oci-secrets/operations'

const request = vi.fn()
const prepareStaticEndpoint = vi.fn()
const prepareDiscoveredEndpoint = vi.fn()
const client: OciClient = { request, prepareStaticEndpoint, prepareDiscoveredEndpoint }
const endpoint = { origin: 'https://example.oraclecloud.com' } as OciPreparedEndpoint
const keyEndpoint = {
  origin: 'https://example-management.kms.us-ashburn-1.oraclecloud.com',
} as OciPreparedEndpoint

const secret = {
  id: 'secret-1',
  compartmentId: 'compartment-1',
  vaultId: 'vault-1',
  secretName: 'test-secret',
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-01-01T00:00:00Z',
}
const vault = {
  id: 'vault-1',
  compartmentId: 'compartment-1',
  displayName: 'Test Vault',
  lifecycleState: 'ACTIVE',
  vaultType: 'DEFAULT',
  timeCreated: '2026-01-01T00:00:00Z',
  managementEndpoint: keyEndpoint.origin,
  cryptoEndpoint: 'https://example-crypto.kms.us-ashburn-1.oraclecloud.com',
}
const key = {
  id: 'key-1',
  compartmentId: 'compartment-1',
  vaultId: 'vault-1',
  displayName: 'Test Key',
  lifecycleState: 'ENABLED',
  timeCreated: '2026-01-01T00:00:00Z',
  algorithm: 'AES',
  currentKeyVersion: 'key-version-1',
  keyShape: { algorithm: 'AES', length: 32 },
}
const work = {
  id: 'work-1',
  compartmentId: 'compartment-1',
  operationType: 'ROTATE_SECRET',
  status: 'IN_PROGRESS',
  percentComplete: 20,
  timeAccepted: '2026-01-01T00:00:00Z',
  resources: [],
}

function response(body: unknown = [], status = 200): OciAuthenticatedResponse {
  return {
    status,
    headers: { 'opc-next-page': 'next-page', 'opc-work-request-id': 'work-1', etag: 'etag-1' },
    opcRequestId: 'request-1',
    body: status === 200 ? new TextEncoder().encode(JSON.stringify(body)) : new Uint8Array(),
  } as OciAuthenticatedResponse
}

function input(operation: string, values: Record<string, unknown> = {}) {
  return ociSecretsInputSchema.parse({
    operation,
    oauthCredential: 'credential-1',
    secretId: 'secret-1',
    compartmentId: 'compartment-1',
    vaultId: 'vault-1',
    keyId: 'key-1',
    workRequestId: 'work-1',
    secretVersionNumber: 2,
    secretName: 'test-secret',
    ...values,
  })
}

describe('OCI Secrets provider operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareStaticEndpoint.mockResolvedValue(endpoint)
    prepareDiscoveredEndpoint.mockResolvedValue(keyEndpoint)
    request.mockResolvedValue(response())
  })

  it.each([
    ['list_secrets', 'vaults', '/20180608/secrets', [], 'secrets'],
    ['get_secret', 'vaults', '/20180608/secrets/secret-1', secret, 'secret'],
    ['list_secret_versions', 'vaults', '/20180608/secrets/secret-1/versions', [], 'secretVersions'],
    [
      'get_secret_version',
      'vaults',
      '/20180608/secrets/secret-1/version/2',
      { secretId: 'secret-1', versionNumber: 2 },
      'secretVersion',
    ],
    [
      'get_secret_bundle',
      'secrets.vaults',
      '/20190301/secretbundles/secret-1',
      { secretId: 'secret-1', versionNumber: 2 },
      'secretBundle',
    ],
    [
      'list_secret_bundle_versions',
      'secrets.vaults',
      '/20190301/secretbundles/secret-1/versions',
      [],
      'secretBundleVersions',
    ],
    ['list_vaults', 'kms', '/20180608/vaults', [], 'vaults'],
    ['get_vault', 'kms', '/20180608/vaults/vault-1', vault, 'vault'],
    ['list_work_requests', 'iaas', '/20160918/workRequests', [], 'workRequests'],
    ['get_work_request', 'iaas', '/20160918/workRequests/work-1', work, 'workRequest'],
    ['list_work_request_errors', 'iaas', '/20160918/workRequests/work-1/errors', [], 'errors'],
    ['list_work_request_logs', 'iaas', '/20160918/workRequests/work-1/logs', [], 'logs'],
  ] as const)(
    'routes %s to its documented API',
    async (operation, serviceName, encodedPath, body, field) => {
      request.mockResolvedValue(response(body))
      const result = await executeOciSecretsOperation(client, input(operation))
      expect(prepareStaticEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: 'oci_secrets', serviceName })
      )
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', encodedPath }))
      expect(result.success).toBe(true)
      expect(result.output[field]).toBeDefined()
    }
  )

  it('returns one bounded page with the provider cursor and exact filters', async () => {
    const result = await executeOciSecretsOperation(
      client,
      input('list_secrets', {
        name: 'payment & billing',
        page: 'page+/=',
        limit: 7,
        sortBy: 'NAME',
        sortOrder: 'ASC',
      })
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].queryPairs).toEqual([
      ['limit', '7'],
      ['page', 'page+/='],
      ['compartmentId', 'compartment-1'],
      ['name', 'payment & billing'],
      ['vaultId', 'vault-1'],
      ['sortBy', 'NAME'],
      ['sortOrder', 'ASC'],
    ])
    expect(result.output.nextPage).toBe('next-page')
  })

  it('passes raw IDs through segment encoding exactly once and forwards cancellation', async () => {
    request.mockResolvedValue(response(secret))
    const signal = new AbortController().signal
    await executeOciSecretsOperation(
      client,
      input('get_secret', { secretId: ' folder/a%2Fb ' }),
      signal
    )
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        encodedPath: '/20180608/secrets/folder%2Fa%252Fb',
        signal,
      })
    )
  })

  it.each([
    ['schedule_secret_deletion', '/secrets/secret-1/actions/scheduleDeletion', '{}'],
    ['cancel_secret_deletion', '/secrets/secret-1/actions/cancelDeletion', ''],
    [
      'schedule_secret_version_deletion',
      '/secrets/secret-1/version/2/actions/scheduleDeletion',
      '{}',
    ],
    ['cancel_secret_version_deletion', '/secrets/secret-1/version/2/actions/cancelDeletion', ''],
    ['cancel_secret_rotation', '/secrets/secret-1/actions/cancelRotation', ''],
    [
      'change_secret_compartment',
      '/secrets/secret-1/actions/changeCompartment',
      '{"compartmentId":"compartment-1"}',
    ],
  ])('preserves body and no-content semantics for %s', async (operation, path, body) => {
    request.mockResolvedValue(response(undefined, 204))
    const result = await executeOciSecretsOperation(
      client,
      input(operation, { ifMatch: 'etag-before' })
    )
    const sent = request.mock.calls[0][0]
    expect(sent).toMatchObject({
      method: 'POST',
      encodedPath: `/20180608${path}`,
      headers: { 'if-match': 'etag-before' },
    })
    expect(new TextDecoder().decode(sent.body)).toBe(body)
    expect(result.output).toEqual({
      status: 204,
      opcRequestId: 'request-1',
      ...(operation === 'cancel_secret_rotation' ? {} : { etag: 'etag-1' }),
    })
    expect(sent.retry).toBeUndefined()
  })

  it('reports accepted rotation and its work request without claiming completion', async () => {
    request.mockResolvedValue(response(undefined, 202))
    const result = await executeOciSecretsOperation(
      client,
      input('rotate_secret', { retryToken: 'rotation-token' })
    )
    expect(result.output).toEqual({
      status: 202,
      opcRequestId: 'request-1',
      workRequestId: 'work-1',
    })
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/20180608/secrets/secret-1/actions/rotate',
      retry: { kind: 'tokenized', retryToken: 'rotation-token', maxAttempts: 3 },
    })
    expect(request.mock.calls[0][0].headers).not.toHaveProperty('opc-retry-token')
    expect(request.mock.calls[0][0].body).toHaveLength(0)
  })

  it('retrieves by name with query parameters and an empty POST body', async () => {
    request.mockResolvedValue(response({ secretId: 'secret-1', versionNumber: 3 }))
    const result = await executeOciSecretsOperation(
      client,
      input('get_secret_bundle_by_name', { stage: 'PREVIOUS' })
    )
    const sent = request.mock.calls[0][0]
    expect(sent).toMatchObject({
      method: 'POST',
      encodedPath: '/20190301/secretbundles/actions/getByName',
    })
    expect(sent.queryPairs).toEqual([
      ['stage', 'PREVIOUS'],
      ['secretName', 'test-secret'],
      ['vaultId', 'vault-1'],
    ])
    expect(sent.body).toHaveLength(0)
    expect(result.output).not.toHaveProperty('etag')
  })

  it.each(['create_secret', 'rotate_secret', 'change_secret_compartment'])(
    'passes %s idempotency through the foundation retry policy',
    async (operation) => {
      request.mockResolvedValue(
        response(
          secret,
          operation === 'create_secret' ? 200 : operation === 'rotate_secret' ? 202 : 204
        )
      )
      await executeOciSecretsOperation(
        client,
        input(operation, {
          secretContent: { contentType: 'BASE64', content: 'c3ludGhldGlj' },
          retryToken: 'idempotency-token',
        })
      )
      const sent = request.mock.calls[0][0]
      expect(sent.retry).toEqual({
        kind: 'tokenized',
        retryToken: 'idempotency-token',
        maxAttempts: 3,
      })
      expect(sent.headers).not.toHaveProperty('opc-retry-token')
    }
  )

  it.each(['create_secret', 'update_secret'])(
    'sends documented configuration for %s without credential fields',
    async (operation) => {
      request.mockResolvedValue(response(secret))
      const config = {
        secretContent: { contentType: 'BASE64', content: 'dGVzdA==' },
        freeformTags: {},
        definedTags: {},
        metadata: { purpose: 'example' },
        rotationConfig: {
          targetSystemDetails: { targetSystemType: 'FUNCTION', functionId: 'function-1' },
        },
        replicationConfig: {
          replicationTargets: [
            { targetKeyId: 'key-2', targetVaultId: 'vault-2', targetRegion: 'us-phoenix-1' },
          ],
        },
      }
      await executeOciSecretsOperation(client, input(operation, config))
      const sent = request.mock.calls[0][0]
      const body = JSON.parse(new TextDecoder().decode(sent.body))
      expect(sent.method).toBe(operation === 'create_secret' ? 'POST' : 'PUT')
      expect(body).toMatchObject(config)
      expect(body).not.toHaveProperty('oauthCredential')
      expect(body).not.toHaveProperty('accessToken')
      expect(body).not.toHaveProperty('operation')
    }
  )

  it('uses the original authenticated GetVault response to prepare key discovery', async () => {
    const discovery = response(vault)
    request.mockResolvedValueOnce(discovery).mockResolvedValueOnce(response([key]))
    await executeOciSecretsOperation(
      client,
      input('list_keys', { protectionMode: 'SOFTWARE', algorithm: 'AES' })
    )
    expect(prepareDiscoveredEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'kms',
        source: { kind: 'json', path: ['managementEndpoint'] },
        responsePolicy: expect.objectContaining({ serviceName: 'kms', kind: 'static' }),
      }),
      discovery
    )
    expect(prepareDiscoveredEndpoint.mock.calls[0][1]).toBe(discovery)
    expect(request.mock.calls[1][0]).toMatchObject({
      endpoint: keyEndpoint,
      encodedPath: '/20180608/keys',
    })
    expect(request.mock.calls[1][0].queryPairs).toContainEqual(['protectionMode', 'SOFTWARE'])
  })

  it('creates a pending version using the existing automatic generation configuration', async () => {
    request.mockResolvedValue(response(secret))
    await executeOciSecretsOperation(
      client,
      input('update_secret', {
        secretContent: { contentType: 'BASE64', stage: 'PENDING' },
      })
    )
    const sent = request.mock.calls[0][0]
    expect(sent.method).toBe('PUT')
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({
      secretContent: { contentType: 'BASE64', stage: 'PENDING' },
    })
  })

  it('gets key shape from the authenticated management endpoint', async () => {
    request.mockResolvedValueOnce(response(vault)).mockResolvedValueOnce(response(key))
    const result = await executeOciSecretsOperation(client, input('get_key'))
    expect(request.mock.calls[1][0]).toMatchObject({
      endpoint: keyEndpoint,
      encodedPath: '/20180608/keys/key-1',
    })
    expect(result.output.key?.keyShape).toEqual({ algorithm: 'AES', length: 32, curveId: null })
    expect(result.output.key).not.toHaveProperty('algorithm')
  })

  it('stops before a key request when endpoint discovery fails', async () => {
    request.mockResolvedValue(response(vault))
    prepareDiscoveredEndpoint.mockRejectedValue(new Error('invalid endpoint'))
    await expect(executeOciSecretsOperation(client, input('get_key'))).rejects.toThrow(
      'invalid endpoint'
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps management and retrieval version names and expiration fields distinct', async () => {
    request
      .mockResolvedValueOnce(
        response([
          {
            secretId: 'secret-1',
            versionNumber: 2,
            name: 'managed-name',
            timeCreated: '2026-01-01T00:00:00Z',
            timeOfExpiry: '2026-02-01T00:00:00Z',
          },
        ])
      )
      .mockResolvedValueOnce(
        response([{ secretId: 'secret-1', versionNumber: 2, versionName: 'bundle-name' }])
      )
    const managed = await executeOciSecretsOperation(client, input('list_secret_versions'))
    const bundles = await executeOciSecretsOperation(client, input('list_secret_bundle_versions'))
    expect(managed.output.secretVersions?.[0]).toMatchObject({
      name: 'managed-name',
      timeOfExpiry: '2026-02-01T00:00:00Z',
    })
    expect(managed.output.secretVersions?.[0]).not.toHaveProperty('versionName')
    expect(bundles.output.secretBundleVersions?.[0]).toMatchObject({ versionName: 'bundle-name' })
    expect(bundles.output.secretBundleVersions?.[0]).not.toHaveProperty('name')
  })

  it('projects metadata without unexpected content fields', async () => {
    request.mockResolvedValue(
      response({ ...secret, secretContent: { content: 'unexpected-content' } })
    )
    const result = await executeOciSecretsOperation(client, input('get_secret'))
    expect(result.output.secret).not.toHaveProperty('secretContent')
  })

  it('accepts nullable configuration metadata without applying request-only restrictions', async () => {
    request.mockResolvedValue(
      response({
        ...secret,
        rotationConfig: {
          targetSystemDetails: { targetSystemType: 'FUNCTION', functionId: 'function-1' },
          rotationInterval: 'PT720H',
          isScheduledRotationEnabled: null,
        },
        secretGenerationContext: {
          generationType: 'PASSPHRASE',
          generationTemplate: 'SECRETS_DEFAULT_PASSWORD',
          secretTemplate: null,
        },
        secretRules: [{ ruleType: 'SECRET_EXPIRY_RULE', timeOfAbsoluteExpiry: null }],
        replicationConfig: { replicationTargets: [], isWriteForwardEnabled: null },
      })
    )
    const result = await executeOciSecretsOperation(client, input('get_secret'))
    expect(result.output.secret?.rotationConfig).toMatchObject({
      rotationInterval: 'PT720H',
      isScheduledRotationEnabled: null,
    })
    expect(result.output.secret?.secretGenerationContext).toMatchObject({
      secretTemplate: null,
      passphraseLength: null,
    })
    expect(result.output.secret?.secretRules).toEqual([
      {
        ruleType: 'SECRET_EXPIRY_RULE',
        timeOfAbsoluteExpiry: null,
        secretVersionExpiryInterval: null,
        isSecretContentRetrievalBlockedOnExpiry: null,
      },
    ])
  })

  it('preserves retrieved base64 content and decodes text only on request', async () => {
    request.mockResolvedValue(
      response({
        secretId: 'secret-1',
        versionNumber: 2,
        secretBundleContent: { contentType: 'BASE64', content: 'dGVzdA==' },
      })
    )
    const encoded = await executeOciSecretsOperation(client, input('get_secret_bundle'))
    const decoded = await executeOciSecretsOperation(
      client,
      input('get_secret_bundle', { decodeContent: true })
    )
    expect(encoded.output).not.toHaveProperty('secretValue')
    expect(encoded.output.secretBundle?.secretBundleContent?.content).toBe('dGVzdA==')
    expect(decoded.output.secretValue).toBe('test')
  })

  it('rejects invalid UTF-8 instead of silently replacing binary bytes', async () => {
    request.mockResolvedValue(
      response({
        secretId: 'secret-1',
        versionNumber: 2,
        secretBundleContent: { contentType: 'BASE64', content: '/w==' },
      })
    )
    await expect(
      executeOciSecretsOperation(client, input('get_secret_bundle', { decodeContent: true }))
    ).rejects.toMatchObject({ code: 'request_failed', status: 502 })
  })

  it('does not expose malformed provider payloads through validation errors', async () => {
    request.mockResolvedValue(response({ message: 'private provider error' }))
    await expect(executeOciSecretsOperation(client, input('get_secret'))).rejects.toMatchObject({
      message: 'OCI request failed',
      status: 502,
    })
  })

  it('makes no request after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeOciSecretsOperation(client, input('list_secrets'), controller.signal)
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
