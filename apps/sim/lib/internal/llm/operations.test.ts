import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  internalAwsCredentialsMock,
  internalAwsCredentialsMockFns,
} from '@sim/testing/mocks/internal-aws-credentials.mock'
import {
  mothershipEnvironmentContextMock,
  mothershipEnvironmentContextMockFns,
} from '@sim/testing/mocks/mothership-environment-context.mock'
import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { providersMock, providersMockFns } from '@sim/testing/mocks/providers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeCredential: vi.fn(),
  importProvenance: vi.fn(),
  isComplete: vi.fn(),
  resolveVertexAccessToken: vi.fn(),
}))

vi.mock('@/providers', () => providersMock)
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorizeCredential,
}))
vi.mock('@/lib/billing/core/attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
vi.mock('@/lib/internal/llm/credentials', () => ({
  resolveVertexAccessToken: mocks.resolveVertexAccessToken,
}))
vi.mock('@/lib/internal/aws/credentials', () => internalAwsCredentialsMock)
vi.mock('@/lib/oauth/token-resolution', () => ({ recordCredentialAccess: vi.fn() }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: vi.fn(),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

const { mockRequireBillingAttributionHeader } = billingAttributionMockFns
const { mockResolveAuthorizedAwsCredential } = internalAwsCredentialsMockFns

import type { LlmOperationError } from '@/lib/internal/llm/errors'
import { executeLlmProviderOperation } from '@/lib/internal/llm/operations'

const prepareEnvironment = mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext
const { mockExecuteProviderRequest } = providersMockFns

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  billingEntity: { type: 'user' as const, id: 'user-1' },
}

const BEDROCK_CREDENTIAL_INPUT = {
  provider: 'bedrock',
  model: 'bedrock/claude',
  bedrockCredential: 'aws-cred',
  workspaceId: 'workspace-1',
}

const AUTHORIZED_AWS_CREDENTIAL = {
  ok: true,
  credentialType: 'service_account',
  resolvedCredentialId: 'aws-cred',
  workspaceId: 'workspace-1',
}

describe('executeLlmProviderOperation', () => {
  beforeEach(() => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mockRequireBillingAttributionHeader.mockReturnValue(BILLING_ATTRIBUTION)
    mocks.importProvenance.mockResolvedValue(true)
    mocks.isComplete.mockReturnValue(true)
    prepareEnvironment.mockResolvedValue({
      resolvedSecretTraceRegistry: {
        importProvenance: mocks.importProvenance,
        isComplete: mocks.isComplete,
      },
    })
    mockExecuteProviderRequest.mockResolvedValue({ content: 'answer', model: 'gpt-4o' })
    mocks.authorizeCredential.mockResolvedValue({ ok: true })
    mocks.resolveVertexAccessToken.mockResolvedValue('vertex-token')
  })

  it('fails before provider work when workspace authorization is denied', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({ hasAccess: false })

    await expect(
      executeLlmProviderOperation(
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'workspace-1' },
        {
          actorUserId: 'user-1',
          headers: new Headers(),
          requestId: 'request-1',
        }
      )
    ).rejects.toMatchObject<LlmOperationError>({ status: 403, body: { error: 'Forbidden' } })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('authorizes and resolves Vertex credentials before provider work', async () => {
    await executeLlmProviderOperation(
      {
        provider: 'vertex',
        model: 'vertex/gemini-2.5-pro',
        vertexCredential: 'credential-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      }
    )

    expect(mocks.authorizeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', authType: 'internal_jwt' }),
      expect.objectContaining({
        credentialId: 'credential-1',
        workflowId: 'workflow-1',
        callerUserId: 'user-1',
      })
    )
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'vertex',
      expect.objectContaining({ apiKey: 'vertex-token' }),
      expect.anything()
    )
  })

  it("signs a Bedrock call with the selected AWS credential's session for the caller", async () => {
    mocks.authorizeCredential.mockResolvedValueOnce(AUTHORIZED_AWS_CREDENTIAL)
    mockResolveAuthorizedAwsCredential.mockResolvedValueOnce({
      accessKeyId: 'ASIASESSIONKEY000001',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
    })

    await executeLlmProviderOperation(
      { ...BEDROCK_CREDENTIAL_INPUT, bedrockRegion: 'eu-west-1', workflowId: 'workflow-1' },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
        executionId: 'execution-1',
      }
    )

    expect(mockResolveAuthorizedAwsCredential).toHaveBeenCalledWith(
      'aws-cred',
      { workspaceId: 'workspace-1', executionId: 'execution-1' },
      undefined
    )

    expect(mocks.authorizeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        credentialId: 'aws-cred',
        workflowId: 'workflow-1',
        callerUserId: 'user-1',
      })
    )
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'bedrock',
      expect.objectContaining({
        bedrockSession: {
          credentialId: 'aws-cred',
          accessKeyId: 'ASIASESSIONKEY000001',
          secretAccessKey: 'session-secret',
          sessionToken: 'session-token',
        },
        bedrockRegion: 'eu-west-1',
      }),
      expect.anything()
    )
  })

  it('refuses a Bedrock credential the caller may not use with the status a Vertex refusal gets', async () => {
    mockExecuteProviderRequest.mockClear()
    mocks.authorizeCredential.mockResolvedValue({ ok: false, error: 'Credential access denied' })

    for (const input of [
      BEDROCK_CREDENTIAL_INPUT,
      { provider: 'vertex', model: 'vertex/gemini-2.5-pro', vertexCredential: 'credential-1' },
    ]) {
      await expect(
        executeLlmProviderOperation(input, {
          actorUserId: 'user-1',
          headers: new Headers(),
          requestId: 'request-1',
        })
      ).rejects.toMatchObject({ status: 401, body: { error: 'Credential access denied' } })
    }
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('fails a Bedrock call whose AWS credential cannot be resolved before provider work', async () => {
    mockExecuteProviderRequest.mockClear()
    mocks.authorizeCredential.mockResolvedValueOnce(AUTHORIZED_AWS_CREDENTIAL)
    mockResolveAuthorizedAwsCredential.mockRejectedValueOnce(new Error('AccessDenied'))

    await expect(
      executeLlmProviderOperation(BEDROCK_CREDENTIAL_INPUT, {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      })
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'Could not use the AWS credential: AccessDenied' },
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('reports an AWS credential STS could not resolve for a moment as unavailable, not invalid', async () => {
    mockExecuteProviderRequest.mockClear()
    mocks.authorizeCredential.mockResolvedValueOnce(AUTHORIZED_AWS_CREDENTIAL)
    mockResolveAuthorizedAwsCredential.mockRejectedValueOnce(
      Object.assign(new Error('Rate exceeded'), {
        name: 'ThrottlingException',
        $metadata: { httpStatusCode: 400 },
      })
    )

    await expect(
      executeLlmProviderOperation(BEDROCK_CREDENTIAL_INPUT, {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      })
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'Could not use the AWS credential: Rate exceeded' },
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })
})
