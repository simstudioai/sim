import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getActiveDraft: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock('@/lib/credentials/connect-draft', () => ({
  getActiveConnectDraft: hoisted.getActiveDraft,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/credentials/application/connection-target', () => ({
  resolveCredentialConnectionTarget: hoisted.resolveTarget,
}))

import { launchCredentialConnection } from '@/lib/credentials/application/launch-credential-connection'

const mocks = {
  ...hoisted,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
}

const principal = createSessionPrincipal()
const draft = {
  id: 'draft-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  providerId: 'google-email',
  displayName: "User's Gmail",
  description: null,
  credentialId: null,
  expiresAt: new Date('2026-08-12T20:15:00.000Z'),
  createdAt: new Date('2026-08-12T20:00:00.000Z'),
}
const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

describe('launchCredentialConnection', () => {
  beforeEach(() => {
    mocks.getActiveDraft.mockResolvedValue(draft)
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveTarget.mockResolvedValue({
      provider: { serviceId: 'gmail' },
      providerId: 'google-email',
    })
  })

  it('loads the exact draft for the signed-in user and reauthorizes its target', async () => {
    const result = await launchCredentialConnection.execute({
      principal,
      input: { draftId: 'draft-1' },
    })

    expect(mocks.getActiveDraft).toHaveBeenCalledWith('draft-1', 'user-1')
    expect(result).toEqual({ draft })
  })

  it('rejects an invalid or expired draft before loading a workspace', async () => {
    mocks.getActiveDraft.mockResolvedValue(null)

    await expect(
      launchCredentialConnection.execute({ principal, input: { draftId: 'draft-missing' } })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
  })
})
