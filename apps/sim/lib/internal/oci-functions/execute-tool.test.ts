/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  create: vi.fn(),
  request: vi.fn(),
  prepare: vi.fn(),
  discover: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { INTERNAL_JWT: 'internal_jwt' } }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: vi.fn(),
  isInternalFileUrl: () => true,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: vi.fn(),
}))
vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: vi.fn() }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciFunctionsTool } from '@/lib/internal/oci-functions/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_functions_get_function',
    input: { oauthCredential: 'supplied-pointer', functionId: 'function-1' },
    context: { workflowId: 'workflow-1', workspaceId: 'trusted-workspace', userId: 'trusted-user' },
    headers: new Headers(),
    requestId: 'sim-request',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorize.mockResolvedValue({
    ok: true,
    resolvedCredentialId: 'authorized-id',
    credentialType: 'service_account',
    workspaceId: 'trusted-workspace',
  })
  mocks.create.mockResolvedValue({
    prepareStaticEndpoint: mocks.prepare,
    request: mocks.request,
    prepareDiscoveredEndpoint: mocks.discover,
  })
  mocks.prepare.mockResolvedValue({ origin: 'management' })
  mocks.discover.mockResolvedValue({ origin: 'invocation' })
  mocks.request.mockResolvedValue({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"id":"function-1"}'),
  })
})

describe('OCI Functions credential execution boundary', () => {
  it('authorizes the supplied pointer but passes only the resolved ID and trusted context into the foundation', async () => {
    const result = await executeOciFunctionsTool(
      request({
        input: {
          oauthCredential: 'supplied-pointer',
          accessToken: 'forged-pointer',
          credentialId: 'forged-id',
          workspaceId: 'forged-workspace',
          userId: 'forged-user',
          functionId: 'function-1',
          region: 'us-phoenix-1',
        },
      })
    )
    expect(result.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(
      { success: true, userId: 'trusted-user', authType: 'internal_jwt' },
      {
        credentialId: 'supplied-pointer',
        workflowId: 'workflow-1',
        workspaceId: 'trusted-workspace',
        callerUserId: 'trusted-user',
      }
    )
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'authorized-id',
      workspaceId: 'trusted-workspace',
      region: 'us-phoenix-1',
      serviceId: 'oci-functions',
    })
    expect(JSON.stringify(mocks.request.mock.calls)).not.toContain('forged')
  })

  it.each([
    { ok: false },
    {
      ok: true,
      resolvedCredentialId: 'id',
      credentialType: 'oauth',
      workspaceId: 'trusted-workspace',
    },
    {
      ok: true,
      resolvedCredentialId: 'id',
      credentialType: 'service_account',
      workspaceId: 'another-workspace',
    },
    { ok: true, credentialType: 'service_account', workspaceId: 'trusted-workspace' },
  ])(
    'rejects denied, wrong-kind, wrong-workspace, or unresolved credentials before creating a provider client',
    async (access) => {
      mocks.authorize.mockResolvedValue(access)
      expect((await executeOciFunctionsTool(request())).status).toBe(403)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('requires trusted context instead of accepting caller-provided workspace or user IDs', async () => {
    expect(
      (
        await executeOciFunctionsTool(
          request({
            context: { workflowId: '' },
            input: {
              oauthCredential: 'id',
              functionId: 'fn',
              workspaceId: 'forged',
              userId: 'forged',
            },
          })
        )
      ).status
    ).toBe(403)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('supports authorized workspace-scoped execution without inventing a workflow ID', async () => {
    expect(
      (
        await executeOciFunctionsTool(
          request({
            context: { workflowId: '', workspaceId: 'trusted-workspace', userId: 'trusted-user' },
          })
        )
      ).status
    ).toBe(200)
    expect(mocks.authorize.mock.calls[0][1].workflowId).toBeUndefined()
  })

  it('rejects invalid operation inputs before authorization or provider access', async () => {
    expect(
      (await executeOciFunctionsTool(request({ input: { oauthCredential: 'id' } }))).status
    ).toBe(400)
    expect(
      (await executeOciFunctionsTool(request({ toolId: 'oci_functions_unknown' }))).status
    ).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('preserves safe Oracle error metadata and marks invocation failures non-retryable', async () => {
    mocks.request.mockRejectedValue(
      new OciClientError('request_failed', { status: 429, opcRequestId: 'oracle-request' })
    )
    const result = await executeOciFunctionsTool(request({ toolId: 'oci_functions_invoke' }))
    expect(result.status).toBe(429)
    expect(await result.json()).toEqual({
      success: false,
      error: 'OCI request failed',
      code: 'request_failed',
      status: 429,
      opcRequestId: 'oracle-request',
      retryable: false,
    })
  })

  it('does not leak unexpected credential-loading or transport errors', async () => {
    mocks.create.mockRejectedValue(new Error('private signing material canary'))
    const result = await executeOciFunctionsTool(request())
    expect(result.status).toBe(500)
    expect(await result.text()).not.toContain('canary')
  })

  it('honors cancellation before authorization', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(executeOciFunctionsTool(request({ signal: controller.signal }))).rejects.toThrow()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
