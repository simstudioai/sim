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
vi.mock('@/lib/internal/oci-notifications/endpoints', () => ({
  prepareOciNotificationsClient: mocks.prepare,
}))
vi.mock('@/lib/internal/oci-notifications/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/oci-notifications/operations')>()),
  executeOciNotificationsOperation: mocks.execute,
}))
vi.mock('@/tools/registry', () => ({ tools: {} }))

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciNotificationsTool } from '@/lib/internal/oci-notifications/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { OciNotificationsBlock } from '@/blocks/blocks/oci_notifications'
import { ociNotificationsUpdateTopicTool } from '@/tools/oci_notifications/update_topic'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

const call: InternalToolOperationCall = {
  toolId: 'oci_notifications_list_topics',
  input: { oauthCredential: 'supplied-reference', compartmentId: 'compartment' },
  headers: new Headers(),
  context: { userId: 'actor', workspaceId: 'workspace', workflowId: 'workflow' },
  requestId: 'request',
}

describe('OCI Notifications internal adapter', () => {
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
    mocks.execute.mockResolvedValue({ status: 200, topics: [] })
  })

  it('passes the authoritative credential and trusted workspace through normal authorization', async () => {
    const signal = new AbortController().signal
    const response = await executeOciNotificationsTool({
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
    expect(await response.json()).toEqual({ success: true, output: { status: 200, topics: [] } })
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
      serviceId: 'oci-notifications',
      region: 'us-phoenix-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        operation: 'oci_notifications_list_topics',
        oauthCredential: 'supplied-reference',
        compartmentId: 'compartment',
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
    expect((await executeOciNotificationsTool(call)).status).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('requires trusted actor and workspace context', async () => {
    expect(
      (await executeOciNotificationsTool({ ...call, context: { workflowId: 'workflow' } })).status
    ).toBe(401)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('permits explicit empty description through shared validation but rejects a missing key', async () => {
    const tool = ociNotificationsUpdateTopicTool
    const input = OciNotificationsBlock.tools.config!.params!({
      operation: tool.id,
      oauthCredential: 'credential',
      topicId: 'topic',
      description: '',
    })
    expect(input.description).toBe('')
    expect(() => validateRequiredParametersAfterMerge(tool.id, tool, input)).not.toThrow()
    expect((await executeOciNotificationsTool({ ...call, toolId: tool.id, input })).status).toBe(
      200
    )
    mocks.execute.mockClear()
    expect(
      (
        await executeOciNotificationsTool({
          ...call,
          toolId: tool.id,
          input: { ...input, description: undefined },
        })
      ).status
    ).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('validates the registered operation and input before credential work', async () => {
    expect(
      (await executeOciNotificationsTool({ ...call, toolId: 'oci_notifications_unknown' })).status
    ).toBe(400)
    expect(
      (
        await executeOciNotificationsTool({
          ...call,
          input: { ...(call.input as object), limit: 51 },
        })
      ).status
    ).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('does not let an input operation replace the dispatched tool', async () => {
    await executeOciNotificationsTool({
      ...call,
      input: { ...(call.input as object), operation: 'oci_notifications_delete_topic' },
    })
    expect(mocks.execute.mock.calls[0][0].operation).toBe('oci_notifications_list_topics')
  })

  it('rejects oversized application input before schema cloning and credential work', async () => {
    const response = await executeOciNotificationsTool({
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
    const response = await executeOciNotificationsTool(call)
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 429, requestId: 'oracle-request' },
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('forwards cancellation without replacing it with a functional response', async () => {
    const controller = new AbortController()
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    await expect(
      executeOciNotificationsTool({ ...call, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
