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
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-events/operations', () => ({
  executeOciEventsOperation: mocks.execute,
  OciEventsInputError: class OciEventsInputError extends Error {},
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciEventsTool } from '@/lib/internal/oci-events/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const connection = { oauthCredential: 'requested-credential', region: 'us-ashburn-1' }
const create = {
  compartmentId: 'compartment',
  displayName: 'Rule',
  condition: {},
  actions: [{ actionType: 'ONS', isEnabled: true, topicId: 'topic' }],
  isEnabled: false,
}
const cases = [
  ['list_rules', { compartmentId: 'compartment' }],
  ['get_rule', { ruleId: 'rule' }],
  ['create_rule', create],
  ['update_rule', { ruleId: 'rule', isEnabled: false }],
  ['delete_rule', { ruleId: 'rule' }],
  ['change_rule_compartment', { ruleId: 'rule', destinationCompartmentId: 'destination' }],
] as const
const client = { bound: true }

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_events_list_rules',
    input: { ...connection, compartmentId: 'compartment' },
    headers: new Headers(),
    context: {
      userId: 'trusted-user',
      workspaceId: 'trusted-workspace',
      workflowId: 'trusted-workflow',
    },
    requestId: 'request',
    ...overrides,
  }
}

describe('OCI Events internal dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      resolvedCredentialId: 'authorized-credential',
      credentialType: 'service_account',
    })
    mocks.createClient.mockResolvedValue(client)
    mocks.execute.mockResolvedValue({ success: true, output: { opcRequestId: 'oracle-request' } })
  })

  it.each(cases)('authorizes and dispatches %s with cancellation', async (operation, input) => {
    const controller = new AbortController()
    const response = await executeOciEventsTool(
      request({
        toolId: `oci_events_${operation}`,
        input: { ...connection, ...input },
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      operation,
      expect.objectContaining(input),
      controller.signal
    )
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authorized-credential',
      workspaceId: 'trusted-workspace',
      serviceId: 'oci_events',
      region: 'us-ashburn-1',
    })
  })

  it('uses execution identity and scope instead of forged input context', async () => {
    await executeOciEventsTool(
      request({
        input: {
          ...connection,
          compartmentId: 'compartment',
          userId: 'forged-user',
          workspaceId: 'forged-workspace',
          workflowId: 'forged-workflow',
          resolvedCredentialId: 'forged-credential',
          serviceId: 'oci_logging',
        },
      })
    )

    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, userId: 'trusted-user' }),
      {
        credentialId: 'requested-credential',
        workspaceId: 'trusted-workspace',
        workflowId: 'trusted-workflow',
        callerUserId: 'trusted-user',
      }
    )
    expect(mocks.execute.mock.calls[0][2]).not.toHaveProperty('workspaceId')
  })

  it.each(['userId', 'workspaceId'] as const)(
    'rejects a missing trusted %s even when supplied in input',
    async (field) => {
      const call = request()
      call.context[field] = undefined
      call.input = { ...connection, compartmentId: 'compartment', [field]: 'forged' }

      expect((await executeOciEventsTool(call)).status).toBe(403)
      expect(mocks.authorize).not.toHaveBeenCalled()
      expect(mocks.createClient).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ok: false },
    { ok: true, credentialType: 'oauth', resolvedCredentialId: 'wrong-kind' },
    { ok: true, credentialType: 'service_account' },
  ])('rejects unauthorized credentials before client creation: %j', async (access) => {
    mocks.authorize.mockResolvedValueOnce(access)
    expect((await executeOciEventsTool(request())).status).toBe(403)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects invalid input before credential or provider work', async () => {
    const response = await executeOciEventsTool(request({ input: connection }))
    expect(response.status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it.each(['oci_events_unknown', 'oci_events_toString', 'wrong_list_rules'])(
    'rejects an unregistered operation %s',
    async (toolId) => {
      expect((await executeOciEventsTool(request({ toolId }))).status).toBe(400)
      expect(mocks.authorize).not.toHaveBeenCalled()
    }
  )

  it.each(cases.slice(2))('does not replay a failed %s mutation', async (operation, input) => {
    mocks.execute.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 503, opcRequestId: 'failed-request' })
    )
    const response = await executeOciEventsTool(
      request({ toolId: `oci_events_${operation}`, input: { ...connection, ...input } })
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      retryable: false,
      output: { opcRequestId: 'failed-request' },
    })
  })

  it('maps foundation credential failures to authorization failures', async () => {
    mocks.createClient.mockRejectedValueOnce(new OciClientError('credential_unavailable'))
    expect((await executeOciEventsTool(request())).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('classifies the response byte limit as a deterministic failure with narrowing guidance', async () => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('response_too_large'))
    const response = await executeOciEventsTool(request())
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      retryable: false,
      error: expect.stringContaining('8 MiB response budget; reduce'),
    })
  })

  it('does not expose unexpected errors or credential material', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('private-key-canary'))
    const response = await executeOciEventsTool(request())
    expect(await response.text()).not.toContain('private-key-canary')
  })

  it('preserves cancellation during authorization', async () => {
    const controller = new AbortController()
    mocks.authorize.mockImplementationOnce(async () => {
      controller.abort()
      return { ok: true, credentialType: 'service_account', resolvedCredentialId: 'credential' }
    })
    await expect(
      executeOciEventsTool(
        request({
          signal: controller.signal,
        })
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
