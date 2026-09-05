/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createClient: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorize,
}))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { INTERNAL_JWT: 'internal_jwt' } }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-secrets/operations', () => ({
  executeOciSecretsOperation: mocks.execute,
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciSecretsTool } from '@/lib/internal/oci-secrets/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const client = { request: vi.fn() }
const access = {
  ok: true,
  resolvedCredentialId: 'canonical-credential',
  credentialType: 'service_account',
  workspaceId: 'workspace-1',
}
const input = {
  oauthCredential: 'selected-credential',
  accessToken: 'resolved-reference',
  region: 'us-ashburn-1',
  compartmentId: 'compartment-1',
  vaultId: 'vault-1',
  secretId: 'secret-1',
  keyId: 'key-1',
  secretName: 'database-password',
  secretVersionNumber: 2,
  workRequestId: 'work-1',
}

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_secrets_get_secret',
    input,
    headers: new Headers(),
    context: { userId: 'user-1', workspaceId: 'workspace-1', workflowId: 'workflow-1' },
    requestId: 'request-1',
    ...overrides,
  }
}

const operations = [
  'list_secrets',
  'get_secret',
  'create_secret',
  'update_secret',
  'list_secret_versions',
  'get_secret_version',
  'schedule_secret_deletion',
  'cancel_secret_deletion',
  'schedule_secret_version_deletion',
  'cancel_secret_version_deletion',
  'rotate_secret',
  'cancel_secret_rotation',
  'change_secret_compartment',
  'get_secret_bundle',
  'get_secret_bundle_by_name',
  'list_secret_bundle_versions',
  'list_vaults',
  'get_vault',
  'list_keys',
  'get_key',
  'list_work_requests',
  'get_work_request',
  'list_work_request_errors',
  'list_work_request_logs',
]

describe('executeOciSecretsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue(access)
    mocks.createClient.mockResolvedValue(client)
    mocks.execute.mockResolvedValue({
      success: true,
      output: { status: 200, opcRequestId: 'oci-1' },
    })
  })

  it.each(operations)(
    'dispatches %s using the registered ID and trusted authority',
    async (operation) => {
      const signal = new AbortController().signal
      const response = await executeOciSecretsTool(
        request({
          toolId: `oci_secrets_${operation}`,
          input: {
            ...input,
            operation: 'cancel_secret_deletion',
            workspaceId: 'untrusted-workspace',
            userId: 'untrusted-user',
            secretContent: { contentType: 'BASE64', content: 'c3ludGhldGlj' },
          },
          signal,
        })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ success: true })
      expect(mocks.authorize).toHaveBeenCalledWith(
        { success: true, userId: 'user-1', authType: 'internal_jwt' },
        {
          credentialId: 'resolved-reference',
          callerUserId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        }
      )
      expect(mocks.createClient).toHaveBeenCalledWith({
        credentialId: 'canonical-credential',
        workspaceId: 'workspace-1',
        serviceId: 'oci_secrets',
        region: 'us-ashburn-1',
      })
      expect(mocks.execute).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ operation }),
        signal
      )
      expect(mocks.execute.mock.calls[0][1]).not.toHaveProperty('workspaceId')
      expect(mocks.execute.mock.calls[0][1]).not.toHaveProperty('userId')
    }
  )

  it('authorizes a selected credential when no injected reference is present', async () => {
    await executeOciSecretsTool(request({ input: { ...input, accessToken: undefined } }))
    expect(mocks.authorize.mock.calls[0][1].credentialId).toBe('selected-credential')
  })

  it('lets an update reuse the stored generation context', async () => {
    const response = await executeOciSecretsTool(
      request({
        toolId: 'oci_secrets_update_secret',
        input: { ...input, enableAutoGeneration: true },
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.execute.mock.calls[0][1]).toMatchObject({ enableAutoGeneration: true })
    expect(mocks.execute.mock.calls[0][1]).not.toHaveProperty('secretGenerationContext')
  })

  it.each([
    { workflowId: 'workflow-1' },
    { workflowId: 'workflow-1', userId: 'user-1' },
    { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
  ])('rejects missing trusted context before authorization or provider access', async (context) => {
    const response = await executeOciSecretsTool(request({ context }))
    expect(response.status).toBe(401)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it.each([
    { ...access, ok: false },
    { ...access, credentialType: 'oauth' },
    { ...access, workspaceId: 'workspace-2' },
    { ...access, resolvedCredentialId: undefined },
  ])(
    'rejects unavailable or mismatched credential authority before provider access',
    async (result) => {
      mocks.authorize.mockResolvedValue(result)
      const response = await executeOciSecretsTool(request())
      expect(response.status).toBe(403)
      expect(mocks.createClient).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['get_secret', { ...input, secretId: '' }],
    ['list_secrets', { ...input, limit: 1001 }],
    ['get_secret_version', { ...input, secretVersionNumber: 1.5 }],
    ['get_secret_bundle', { ...input, stage: 'CURRENT', versionNumber: 2 }],
    ['create_secret', input],
    ['create_secret', { ...input, secretContent: { contentType: 'BASE64', stage: 'CURRENT' } }],
    [
      'create_secret',
      { ...input, secretContent: { contentType: 'BASE64', content: 'plain text' } },
    ],
    ['update_secret', { ...input, currentVersionNumber: 2, secretRules: [] }],
    ['unsupported', input],
  ])('rejects invalid %s inputs before authorization', async (operation, invalidInput) => {
    const response = await executeOciSecretsTool(
      request({ toolId: `oci_secrets_${operation}`, input: invalidInput })
    )
    expect(response.status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns bounded provider errors without exposing exception content or retrying writes', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 429, opcRequestId: 'oci-1' })
    )
    const provider = await executeOciSecretsTool(request())
    await expect(provider.json()).resolves.toMatchObject({
      success: false,
      retryable: false,
      output: { status: 429, opcRequestId: 'oci-1' },
    })

    mocks.execute.mockRejectedValueOnce(new Error('provider-secret-canary'))
    const unexpected = await executeOciSecretsTool(request())
    expect(await unexpected.text()).not.toContain('provider-secret-canary')
  })

  it('propagates cancellation before credential or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(
      executeOciSecretsTool(request({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
