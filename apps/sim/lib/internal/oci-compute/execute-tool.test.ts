/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), createClient: vi.fn(), execute: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { INTERNAL_JWT: 'internal_jwt' } }))
vi.mock('@/lib/api/server', () => ({ getValidationErrorMessage: () => 'Invalid input' }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-compute/operations', () => ({ executeOciComputeOperation: mocks.execute }))

import { executeOciComputeTool } from '@/lib/internal/oci-compute/execute-tool'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_compute_get_instance',
    input: { oauthCredential: 'submitted', region: 'us-ashburn-1', instanceId: 'instance' },
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'workspace', userId: 'user' },
    requestId: 'request',
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({
    ok: true, resolvedCredentialId: 'authoritative', credentialType: 'service_account', workspaceId: 'workspace',
  })
  mocks.createClient.mockResolvedValue({ bound: true })
  mocks.execute.mockResolvedValue({ success: true, output: { status: 200, requestId: 'request' } })
})

describe('OCI Compute trusted execution wiring', () => {
  it('authorizes submitted identity and binds only the resolved credential and trusted scope', async () => {
    const signal = new AbortController().signal
    expect((await executeOciComputeTool(call({ signal }))).status).toBe(200)
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authoritative', workspaceId: 'workspace', serviceId: 'oci_compute', region: 'us-ashburn-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      { bound: true }, 'get_instance', expect.objectContaining({ instanceId: 'instance' }), signal
    )
  })

  it('does not accept payload workspace or compatibility token as authority', async () => {
    const response = await executeOciComputeTool(call({
      input: { oauthCredential: 'submitted', region: 'us-ashburn-1', instanceId: 'instance', workspaceId: 'other', accessToken: 'token' },
    }))
    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects missing trusted context and denied credential use', async () => {
    expect((await executeOciComputeTool(call({ context: { workflowId: '' } }))).status).toBe(401)
    mocks.authorize.mockResolvedValue({ ok: false })
    expect((await executeOciComputeTool(call())).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
