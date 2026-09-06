/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), prepare: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/internal/oci-resource-manager/client', () => ({
  prepareOciResourceManagerClient: mocks.prepare,
  OciResourceManagerError: class extends Error {},
}))
vi.mock('@/lib/internal/oci-resource-manager/operations', () => ({
  executeOciResourceManagerOperation: mocks.execute,
  OCI_RESOURCE_MANAGER_MUTATIONS: new Set([
    'plan',
    'apply',
    'destroy',
    'import_state',
    'plan_rollback',
    'apply_rollback',
    'cancel_job',
    'create_stack',
    'update_stack',
    'delete_stack',
    'change_stack_compartment',
    'update_job',
    'detect_drift',
  ]),
}))

import { executeOciResourceManagerTool } from '@/lib/internal/oci-resource-manager/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_resource_manager_plan',
    input: { oauthCredential: 'supplied', stackId: 'stack' },
    context: {
      userId: 'actor',
      workspaceId: 'workspace',
      workflowId: 'workflow',
      executionId: 'execution',
    },
    headers: new Headers(),
    requestId: 'request',
    ...overrides,
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorize.mockResolvedValue({
    ok: true,
    resolvedCredentialId: 'resolved',
    credentialType: 'service_account',
    workspaceId: 'workspace',
  })
  mocks.prepare.mockResolvedValue({ client: 'client' })
  mocks.execute.mockResolvedValue({
    success: true,
    output: { status: 200, job: { id: 'job', lifecycleState: 'ACCEPTED' } },
  })
})
describe('Resource Manager execution authorization', () => {
  it('uses only the authorized credential ID and trusted workspace/actor', async () => {
    expect((await executeOciResourceManagerTool(request())).status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor' }), {
      credentialId: 'supplied',
      workflowId: 'workflow',
      workspaceId: 'workspace',
      callerUserId: 'actor',
    })
    expect(mocks.prepare).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      region: undefined,
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      'plan',
      expect.anything(),
      expect.objectContaining({
        userId: 'actor',
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'execution',
      })
    )
  })
  it.each([
    { ok: false },
    {
      ok: true,
      resolvedCredentialId: 'resolved',
      credentialType: 'service_account',
      workspaceId: 'other',
    },
    {
      ok: true,
      resolvedCredentialId: 'resolved',
      credentialType: 'oauth',
      workspaceId: 'workspace',
    },
  ])('rejects invalid credential access before preparing a client', async (access) => {
    mocks.authorize.mockResolvedValue(access)
    expect((await executeOciResourceManagerTool(request())).status).toBe(403)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('ignores injected or forged authority and rejects missing trusted actors', async () => {
    expect(
      (
        await executeOciResourceManagerTool(
          request({
            input: {
              oauthCredential: 'supplied',
              stackId: 'stack',
              userId: 'forged',
              accessToken: 'opaque',
              credential: 'forged',
            },
          })
        )
      ).status
    ).toBe(200)
    expect(mocks.execute).toHaveBeenLastCalledWith(
      'plan',
      { oauthCredential: 'supplied', stackId: 'stack' },
      expect.objectContaining({ userId: 'actor', workspaceId: 'workspace' })
    )
    mocks.prepare.mockClear()
    expect(
      (
        await executeOciResourceManagerTool(
          request({ context: { workspaceId: 'workspace', workflowId: 'workflow' } })
        )
      ).status
    ).toBe(403)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('preserves nonretryable mutation failure without exposing arbitrary error contents', async () => {
    mocks.execute.mockRejectedValue(new Error('secret-canary'))
    const result = await executeOciResourceManagerTool(request())
    expect(await result.json()).toMatchObject({ success: false, retryable: false })
    const second = await executeOciResourceManagerTool(request())
    expect(await second.text()).not.toContain('secret-canary')
  })
})
