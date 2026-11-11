/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const { mockGetAwsCredentialConfig, mockResolveAwsSessionCredentials } = vi.hoisted(() => ({
  mockGetAwsCredentialConfig: vi.fn(),
  mockResolveAwsSessionCredentials: vi.fn(),
}))

vi.mock('@/lib/credentials/aws-service-account.server', () => ({
  buildAwsRoleSessionName: (label?: string) => `sim-${label ?? 'credential'}`,
  getAwsCredentialConfig: mockGetAwsCredentialConfig,
  resolveAwsSessionCredentials: mockResolveAwsSessionCredentials,
}))

import {
  ExpiredTokenException,
  IDPCommunicationErrorException,
  IDPRejectedClaimException,
  InvalidIdentityTokenException,
} from '@aws-sdk/client-sts'
import { awsClientCredentials, withAwsCredential } from '@/lib/internal/aws/credentials'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'dynamodb_get',
    input: {
      region: 'us-east-1',
      accessKeyId: 'TESTINLINEKEYID',
      secretAccessKey: 'inline-secret',
    },
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
      accessKeyId: 'TESTINLINEKEYID',
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
    const handler = vi.fn<InternalToolOperationHandler>(async () => Response.json({}))

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
      Response.json(awsClientCredentials('TESTOTHERKEYID', 'other-secret'))
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
      accessKeyId: 'TESTOTHERKEYID',
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

  const stsFailure = (name: string, httpStatusCode: number) =>
    Object.assign(new Error(`${name} from STS`), { name, $metadata: { httpStatusCode } })
  const sdkFailure = (
    Exception:
      | typeof IDPCommunicationErrorException
      | typeof InvalidIdentityTokenException
      | typeof ExpiredTokenException
      | typeof IDPRejectedClaimException
  ) => new Exception({ message: 'from STS', $metadata: { httpStatusCode: 400 } })

  it.each([
    ['STS could not reach the OIDC issuer', sdkFailure(IDPCommunicationErrorException), 503],
    ['STS throttled the exchange', stsFailure('Throttling', 400), 503],
    ['STS failed on its side', stsFailure('InternalFailure', 500), 503],
    [
      'the connection to STS reset',
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      503,
    ],
    [
      'the request handler wrapped a dropped socket',
      new Error('Request failed', {
        cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
      }),
      503,
    ],
    ['the role denies the session', stsFailure('AccessDenied', 403), 403],
    ['STS rejects the identity token', sdkFailure(InvalidIdentityTokenException), 403],
    ['the identity token expired', sdkFailure(ExpiredTokenException), 403],
    ['the issuer rejected the claim', sdkFailure(IDPRejectedClaimException), 403],
  ])('maps a failure where %s to the right status', async (_case, error, status) => {
    mockGetAwsCredentialConfig.mockResolvedValue({ config: {}, owner: { workspaceId: 'ws-1' } })
    mockResolveAwsSessionCredentials.mockRejectedValue(error)
    const handler = vi.fn()

    const response = (await withAwsCredential(handler)(
      call({
        context: {
          workflowId: 'wf-1',
          workspaceId: 'ws-1',
          authorizedServiceAccountCredential: { credentialId: 'cred-1', service: 'aws' },
        },
      })
    )) as Response

    expect(response.status).toBe(status)
    expect(handler).not.toHaveBeenCalled()
  })
})
