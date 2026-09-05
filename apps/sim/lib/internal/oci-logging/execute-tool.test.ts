/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeOciLoggingTool } from '@/lib/internal/oci-logging/execute-tool'
import {
  OCI_LOGGING_INGESTION_POLICY,
  OCI_LOGGING_MANAGEMENT_POLICY,
} from '@/lib/internal/oci-logging/operations'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_logging_list_log_groups',
    input: { ociCredential: 'supplied', compartmentId: 'compartment' },
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'workspace', userId: 'actor' },
    requestId: 'request',
    ...overrides,
  }
}

describe('OCI Logging tool authorization and execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace',
    })
    mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
    mocks.prepare.mockResolvedValue({ origin: 'https://logging.us-phoenix-1.oci.oraclecloud.com' })
    mocks.request.mockResolvedValue({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('[]'),
    })
  })

  it('binds the authorized resolved ID and trusted scope before provider work', async () => {
    const response = await executeOciLoggingTool(
      call({
        input: {
          ociCredential: 'supplied',
          compartmentId: 'compartment',
          region: 'us-phoenix-1',
          workspaceId: 'forged',
          userId: 'forged',
        },
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor' }), {
      credentialId: 'supplied',
      workspaceId: 'workspace',
      workflowId: 'workflow',
      callerUserId: 'actor',
    })
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      serviceId: 'oci-logging',
      region: 'us-phoenix-1',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(OCI_LOGGING_MANAGEMENT_POLICY)
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!
    )
  })

  it.each([
    { ok: false },
    {
      ok: true,
      credentialType: 'oauth',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace',
    },
    { ok: true, credentialType: 'service_account', workspaceId: 'workspace' },
    {
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'other',
    },
  ])('rejects unavailable or unbound credentials before creating a client: %j', async (access) => {
    mocks.authorize.mockResolvedValue(access)
    expect((await executeOciLoggingTool(call())).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([{ workflowId: 'workflow' }, { workflowId: '', userId: 'actor' }])(
    'requires trusted user and workspace context',
    async (context) => {
      expect((await executeOciLoggingTool(call({ context }))).status).toBe(401)
      expect(mocks.authorize).not.toHaveBeenCalled()
    }
  )

  it('rejects oversized input before authorization or provider work', async () => {
    const response = await executeOciLoggingTool(
      call({
        input: {
          ociCredential: 'supplied',
          compartmentId: 'compartment',
          extra: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES),
        },
      })
    )
    expect(response.status).toBe(413)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects invalid ingestion before transmission and uses the ingestion policy on success', async () => {
    const input = {
      ociCredential: 'supplied',
      logId: 'custom',
      logEntryBatches: [
        {
          source: 'app',
          type: 'events',
          defaultlogentrytime: '2026-09-01T00:00:00.000Z',
          entries: [{ id: 'stable', data: 'event' }],
        },
      ],
    }
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array() })
    const invalid = await executeOciLoggingTool(
      call({ toolId: 'oci_logging_put_logs', input: { ...input, logEntryBatches: [] } })
    )
    expect(invalid.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    const response = await executeOciLoggingTool(call({ toolId: 'oci_logging_put_logs', input }))
    expect(await response.json()).toEqual({ success: true, output: { accepted: true } })
    expect(mocks.prepare).toHaveBeenCalledWith(OCI_LOGGING_INGESTION_POLICY)
  })

  it('does not expose unexpected errors or invite replay after a write failure', async () => {
    mocks.request.mockRejectedValue(new Error('private-key-canary'))
    const response = await executeOciLoggingTool(
      call({
        toolId: 'oci_logging_delete_log_group',
        input: { ociCredential: 'supplied', logGroupId: 'group' },
      })
    )
    expect(await response.json()).toEqual({
      success: false,
      error: 'OCI Logging operation failed',
      retryable: false,
    })
  })

  it('stops after authorization when canceled, and forwards active cancellation to the client', async () => {
    const controller = new AbortController()
    mocks.authorize.mockImplementationOnce(async () => {
      controller.abort()
      return { ok: true }
    })
    await expect(executeOciLoggingTool(call({ signal: controller.signal }))).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
    const active = new AbortController()
    await executeOciLoggingTool(call({ signal: active.signal }))
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ signal: active.signal }))
  })
})
