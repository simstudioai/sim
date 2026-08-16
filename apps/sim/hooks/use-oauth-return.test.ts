/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  requireWorkspaceCredentialListResponse: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))
vi.mock('@/hooks/queries/utils/fetch-workspace-credentials', () => ({
  requireWorkspaceCredentialListResponse: mocks.requireWorkspaceCredentialListResponse,
}))

import type { OAuthReturnContext } from '@/lib/credentials/client-state'
import { resolveOAuthMessage } from '@/hooks/use-oauth-return'

const context: OAuthReturnContext = {
  origin: 'integrations',
  displayName: 'New Gmail',
  providerId: 'google-email',
  preCount: 1,
  baselineCredentials: [
    {
      id: 'credential-existing',
      accountId: 'account-1',
      updatedAt: '2026-08-14T17:00:00.000Z',
    },
  ],
  workspaceId: 'workspace-1',
  requestedAt: Date.now(),
}

const existingCredential = {
  id: 'credential-existing',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
  displayName: 'Existing Gmail',
  description: null,
  providerId: 'google-email',
  accountId: 'account-1',
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-14T18:00:00.000Z',
}

describe('resolveOAuthMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestJson.mockResolvedValue({})
  })

  it('recognizes an idempotent already-connected account from its reconnect timestamp', async () => {
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([existingCredential])

    await expect(resolveOAuthMessage(context)).resolves.toEqual({
      kind: 'success',
      text: 'This account is already connected as "Existing Gmail".',
    })
  })

  it('keeps explicit update-access flows on the reconnect success path without a baseline', async () => {
    await expect(
      resolveOAuthMessage({
        ...context,
        baselineCredentials: undefined,
        reconnect: true,
      })
    ).resolves.toEqual({
      kind: 'success',
      text: '"New Gmail" reconnected successfully.',
    })
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })

  it('does not report success when the credential list is unchanged', async () => {
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([
      {
        ...existingCredential,
        updatedAt: context.baselineCredentials?.[0].updatedAt,
      },
    ])

    await expect(resolveOAuthMessage(context)).resolves.toEqual({
      kind: 'error',
      text: 'We couldn’t verify the "New Gmail" connection. Try again.',
    })
  })
})
