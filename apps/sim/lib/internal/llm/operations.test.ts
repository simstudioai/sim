import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
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
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
vi.mock('@/lib/internal/llm/credentials', () => ({
  resolveVertexAccessToken: mocks.resolveVertexAccessToken,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: vi.fn(),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

const { mockRequireBillingAttributionHeader } = billingAttributionMockFns

import type { LlmOperationError } from '@/lib/internal/llm/errors'
import { executeLlmProviderOperation } from '@/lib/internal/llm/operations'

const prepareEnvironment = mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext
const { mockExecuteProviderRequest } = providersMockFns

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  billingEntity: { type: 'user' as const, id: 'user-1' },
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
})
