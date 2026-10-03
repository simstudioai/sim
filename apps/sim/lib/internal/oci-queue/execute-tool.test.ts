/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createClient: vi.fn(),
  prepare: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { INTERNAL_JWT: 'internal_jwt' } }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-queue/endpoints', () => ({ prepareOciQueueClient: mocks.prepare }))
vi.mock('@/lib/internal/oci-queue/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/oci-queue/operations')>()),
  executeOciQueueOperation: mocks.execute,
}))

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciQueueTool } from '@/lib/internal/oci-queue/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const call: InternalToolOperationCall = {
  toolId: 'oci_queue_get_messages',
  input: { oauthCredential: 'supplied-reference', queueId: 'queue', timeoutInSeconds: 0 },
  headers: new Headers(),
  context: { userId: 'actor', workspaceId: 'workspace', workflowId: 'workflow' },
  requestId: 'request',
}

describe('OCI Queue internal adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      resolvedCredentialId: 'resolved-id',
      credentialType: 'service_account',
      workspaceId: 'workspace',
    })
    mocks.createClient.mockResolvedValue('client')
    mocks.prepare.mockResolvedValue('prepared')
    mocks.execute.mockResolvedValue({ status: 200, messages: [] })
  })

  it('passes the authoritative credential and trusted workspace through normal authorization', async () => {
    const signal = new AbortController().signal
    const response = await executeOciQueueTool({
      ...call,
      signal,
      input: {
        ...(call.input as object),
        workspaceId: 'untrusted',
        accessToken: 'placeholder',
        endpoint: 'https://attacker.example',
        region: 'us-phoenix-1',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, output: { status: 200, messages: [] } })
    expect(mocks.authorize).toHaveBeenCalledWith(
      { success: true, userId: 'actor', authType: 'internal_jwt' },
      {
        credentialId: 'supplied-reference',
        workspaceId: 'workspace',
        workflowId: 'workflow',
        callerUserId: 'actor',
      }
    )
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'resolved-id',
      workspaceId: 'workspace',
      serviceId: 'oci-queue',
      region: 'us-phoenix-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        operation: 'oci_queue_get_messages',
        oauthCredential: 'supplied-reference',
        queueId: 'queue',
        timeoutInSeconds: 0,
        region: 'us-phoenix-1',
      },
      'prepared',
      signal
    )
  })

  it.each([
    { ok: false },
    { ok: true, credentialType: 'oauth', workspaceId: 'workspace', resolvedCredentialId: 'id' },
    {
      ok: true,
      credentialType: 'service_account',
      workspaceId: 'other',
      resolvedCredentialId: 'id',
    },
    { ok: true, credentialType: 'service_account', workspaceId: 'workspace' },
  ])('rejects denied or mismatched authorization: %j', async (access) => {
    mocks.authorize.mockResolvedValue(access)
    expect((await executeOciQueueTool(call)).status).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('requires trusted actor and workspace context', async () => {
    expect(
      (await executeOciQueueTool({ ...call, context: { workflowId: 'workflow' } })).status
    ).toBe(401)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('validates the registered operation and input before credential work', async () => {
    expect((await executeOciQueueTool({ ...call, toolId: 'oci_queue_unknown' })).status).toBe(400)
    expect(
      (await executeOciQueueTool({ ...call, input: { ...(call.input as object), limit: 21 } }))
        .status
    ).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('does not let an input operation replace the dispatched tool', async () => {
    await executeOciQueueTool({
      ...call,
      input: { ...(call.input as object), operation: 'oci_queue_delete_queue' },
    })
    expect(mocks.execute.mock.calls[0][0].operation).toBe('oci_queue_get_messages')
  })

  it('rejects oversized application input before schema cloning and credential work', async () => {
    const response = await executeOciQueueTool({
      ...call,
      input: { ...(call.input as object), messageReceipt: 'r'.repeat(DEFAULT_MAX_JSON_BODY_BYTES) },
    })
    expect(response.status).toBe(413)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('preserves foundation request errors and request IDs without retrying', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 429, opcRequestId: 'oracle-request' })
    )
    const response = await executeOciQueueTool(call)
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 429, requestId: 'oracle-request' },
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('keeps valid partial batches successful at the tool boundary', async () => {
    mocks.execute.mockResolvedValueOnce({
      status: 200,
      allSucceeded: false,
      clientFailures: 1,
      serverFailures: 0,
      entries: [{ index: 0, success: false, errorCode: 400, errorMessage: 'Expired receipt' }],
    })
    const response = await executeOciQueueTool({
      ...call,
      toolId: 'oci_queue_delete_messages',
      input: {
        oauthCredential: 'credential',
        queueId: 'queue',
        entries: [{ receipt: 'receipt' }],
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, output: { allSucceeded: false } })
  })

  it('forwards cancellation without replacing it with a functional response', async () => {
    const controller = new AbortController()
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    await expect(executeOciQueueTool({ ...call, signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
