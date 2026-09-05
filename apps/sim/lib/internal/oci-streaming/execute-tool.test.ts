/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { AuthType } from '@/lib/auth/hybrid'
import { executeOciStreamingTool } from '@/lib/internal/oci-streaming/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_streaming_list_streams',
    input: {
      operation: 'list_streams',
      ociCredential: 'supplied-reference',
      compartmentId: 'compartment-1',
      ociRegion: 'us-ashburn-1',
    },
    context: { userId: 'actor-1', workspaceId: 'workspace-1', workflowId: 'workflow-1' },
    headers: new Headers(),
    requestId: 'request-1',
    ...overrides,
  }
}

describe('OCI Streaming trusted credential boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved-credential',
      workspaceId: 'workspace-1',
    })
    mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
    mocks.prepare.mockResolvedValue({
      origin: 'https://streaming.us-ashburn-1.oci.oraclecloud.com',
    })
    mocks.request.mockResolvedValue({
      status: 200,
      body: new TextEncoder().encode('[]'),
      headers: {},
    })
  })

  it('passes only the resolved credential ID and trusted workspace to the foundation', async () => {
    const response = await executeOciStreamingTool(call())
    expect(response.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(
      { success: true, userId: 'actor-1', authType: AuthType.INTERNAL_JWT },
      {
        credentialId: 'supplied-reference',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        callerUserId: 'actor-1',
      }
    )
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved-credential',
      workspaceId: 'workspace-1',
      serviceId: 'oci-streaming',
      region: 'us-ashburn-1',
    })
  })

  it.each([
    { ok: false },
    {
      ok: true,
      credentialType: 'oauth',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace-1',
    },
    { ok: true, credentialType: 'service_account', workspaceId: 'workspace-1' },
    {
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'other-workspace',
    },
  ])('starts no provider work for unauthorized credential resolution', async (access) => {
    mocks.authorize.mockResolvedValue(access)
    expect((await executeOciStreamingTool(call())).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([
    {
      freeformTags: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), 'value'])),
    },
    {
      definedTags: {
        namespace: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), 'value'])),
      },
    },
    { freeformTags: { key: 'x'.repeat(257) } },
    {
      definedTags: {
        namespace: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [String(i), 'é'.repeat(256)])
        ),
      },
    },
  ])(
    'rejects oversized administrative tags before authorization or provider work',
    async (tags) => {
      const response = await executeOciStreamingTool(
        call({
          toolId: 'oci_streaming_update_stream',
          input: {
            operation: 'update_stream',
            ociCredential: 'credential',
            streamId: 'stream',
            ...tags,
          },
        })
      )
      expect(response.status).toBe(400)
      expect(mocks.authorize).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('rejects forged context in operation input before authorization', async () => {
    const request = call()
    request.input = {
      operation: 'list_streams',
      ociCredential: 'credential',
      compartmentId: 'compartment',
      workspaceId: 'forged',
      _context: { userId: 'forged' },
    }
    expect((await executeOciStreamingTool(request)).status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects missing trusted identity and mismatched operation IDs', async () => {
    expect((await executeOciStreamingTool(call({ context: { workflowId: '' } }))).status).toBe(401)
    expect(
      (await executeOciStreamingTool(call({ toolId: 'oci_streaming_delete_stream' }))).status
    ).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('does not load credentials after cancellation while authorization is pending', async () => {
    const controller = new AbortController()
    let finish: ((value: unknown) => void) | undefined
    mocks.authorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = executeOciStreamingTool(call({ signal: controller.signal }))
    controller.abort(new DOMException('Canceled', 'AbortError'))
    await pending
    finish?.({
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace-1',
    })
    await Promise.resolve()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
