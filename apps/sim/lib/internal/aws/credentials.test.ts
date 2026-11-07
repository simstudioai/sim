/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const { mockGetAwsCredentialConfig, mockResolveAwsSessionCredentials } = vi.hoisted(() => ({
  mockGetAwsCredentialConfig: vi.fn(),
  mockResolveAwsSessionCredentials: vi.fn(),
}))

vi.mock('@/lib/credentials/aws-service-account.server', () => ({
  buildAwsRoleSessionName: (label?: string) => `sim-${label ?? 'credential'}`,
  getAwsCredentialConfig: mockGetAwsCredentialConfig,
  resolveAwsSessionCredentials: mockResolveAwsSessionCredentials,
}))

import { awsClientCredentials, withAwsCredential } from '@/lib/internal/aws/credentials'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'dynamodb_get',
    input: { region: 'us-east-1', accessKeyId: 'AKIAINLINE', secretAccessKey: 'inline-secret' },
    headers: new Headers(),
    context: { workflowId: 'wf-1', workspaceId: 'ws-1', executionId: 'exec-1' },
    requestId: 'req-1',
    ...overrides,
  }
}

describe('withAwsCredential', () => {
  it('hands an inline-key call to the family handler untouched', async () => {
    const request = call()
    const handler = vi.fn(async (received: InternalToolOperationCall) => {
      const input = received.input as { accessKeyId: string; secretAccessKey: string }
      return Response.json(awsClientCredentials(input.accessKeyId, input.secretAccessKey))
    })

    const response = await withAwsCredential(handler)(request)

    expect(handler.mock.calls[0][0]).toBe(request)
    expect(await (response as Response).json()).toStrictEqual({
      accessKeyId: 'AKIAINLINE',
      secretAccessKey: 'inline-secret',
    })
    expect(mockGetAwsCredentialConfig).not.toHaveBeenCalled()
  })

  it('substitutes the resolved session keys and signs with their session token', async () => {
    mockGetAwsCredentialConfig.mockResolvedValue({
      config: { authType: 'oidc_role' },
      owner: { workspaceId: 'ws-1' },
    })
    mockResolveAwsSessionCredentials.mockResolvedValue({
      accessKeyId: 'ASIASESSION',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
    })
    const handler = vi.fn(async (received: InternalToolOperationCall) => {
      const input = received.input as { accessKeyId: string; secretAccessKey: string }
      return Response.json(awsClientCredentials(input.accessKeyId, input.secretAccessKey))
    })

    const response = await withAwsCredential(handler)(
      call({
        input: { region: 'us-east-1', tableName: 'Users' },
        context: {
          workflowId: 'wf-1',
          workspaceId: 'ws-1',
          executionId: 'exec-1',
          authorizedServiceAccountCredential: { credentialId: 'cred-1', service: 'aws' },
        },
      })
    )

    expect(mockGetAwsCredentialConfig).toHaveBeenCalledWith('cred-1', {
      workspaceId: 'ws-1',
      organizationId: undefined,
    })
    expect(handler.mock.calls[0][0].input).toMatchObject({
      region: 'us-east-1',
      tableName: 'Users',
      accessKeyId: 'ASIASESSION',
      secretAccessKey: 'session-secret',
    })
    expect(await (response as Response).json()).toStrictEqual({
      accessKeyId: 'ASIASESSION',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
    })
  })

  it('ignores a credential the executor authorized for another service', async () => {
    const request = call({
      context: {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        authorizedServiceAccountCredential: { credentialId: 'oracle-1', service: 'oracledb' },
      },
    })
    const handler = vi.fn(async () => Response.json({}))

    await withAwsCredential(handler)(request)

    expect(handler.mock.calls[0][0]).toBe(request)
    expect(mockGetAwsCredentialConfig).not.toHaveBeenCalled()
  })

  it('never attaches a session token to keys other than the resolved pair', async () => {
    mockGetAwsCredentialConfig.mockResolvedValue({ config: {}, owner: { workspaceId: 'ws-1' } })
    mockResolveAwsSessionCredentials.mockResolvedValue({
      accessKeyId: 'ASIASESSION',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
    })
    const handler = vi.fn(async () =>
      Response.json(awsClientCredentials('AKIAOTHER', 'other-secret'))
    )

    const response = await withAwsCredential(handler)(
      call({
        context: {
          workflowId: 'wf-1',
          workspaceId: 'ws-1',
          authorizedServiceAccountCredential: { credentialId: 'c', service: 'aws' },
        },
      })
    )

    expect(await (response as Response).json()).toStrictEqual({
      accessKeyId: 'AKIAOTHER',
      secretAccessKey: 'other-secret',
    })
  })

  it('refuses the call when the credential cannot be resolved, without running the handler', async () => {
    mockGetAwsCredentialConfig.mockRejectedValue(new Error('AWS credential is unavailable'))
    const handler = vi.fn()

    const response = (await withAwsCredential(handler)(
      call({
        context: {
          workflowId: 'wf-1',
          workspaceId: 'ws-2',
          authorizedServiceAccountCredential: { credentialId: 'cred-1', service: 'aws' },
        },
      })
    )) as Response

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('awsClientCredentials', () => {
  it('returns exactly the inline pair outside a saved-credential call', () => {
    expect(awsClientCredentials('AKIAINLINE', 'inline-secret')).toStrictEqual({
      accessKeyId: 'AKIAINLINE',
      secretAccessKey: 'inline-secret',
    })
  })
})
