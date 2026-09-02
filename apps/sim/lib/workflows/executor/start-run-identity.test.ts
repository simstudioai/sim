/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserEmailById } = vi.hoisted(() => ({
  mockGetUserEmailById: vi.fn(),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailById: mockGetUserEmailById,
}))

import { resolveStartBlockRunIdentity } from '@/lib/workflows/executor/start-run-identity'

describe('resolveStartBlockRunIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('identifies the owner of a personal API key', async () => {
    mockGetUserEmailById.mockResolvedValue('owner@example.com')

    await expect(
      resolveStartBlockRunIdentity({
        kind: 'personal_api_key',
        userId: 'user-1',
        keyId: 'key-1',
      })
    ).resolves.toEqual({
      subject: {
        kind: 'sim_user',
        userId: 'user-1',
        email: 'owner@example.com',
      },
    })
    expect(mockGetUserEmailById).toHaveBeenCalledWith('user-1')
  })

  it('exposes the email proven by a chat authentication gate', async () => {
    await expect(
      resolveStartBlockRunIdentity({
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      })
    ).resolves.toEqual({
      subject: { kind: 'authenticated_email', email: 'person@example.com' },
    })
    expect(mockGetUserEmailById).not.toHaveBeenCalled()
  })

  it('preserves an external webhook subject without treating it as a Sim user', async () => {
    await expect(
      resolveStartBlockRunIdentity({
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'team-1',
          subjectId: 'slack-user-1',
        },
      })
    ).resolves.toEqual({
      subject: {
        kind: 'external_user',
        provider: 'slack',
        tenantId: 'team-1',
        subjectId: 'slack-user-1',
      },
    })
    expect(mockGetUserEmailById).not.toHaveBeenCalled()
  })

  it('does not invent a user for an actorless workspace API key', async () => {
    await expect(
      resolveStartBlockRunIdentity({
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      })
    ).resolves.toEqual({ subject: null })
    expect(mockGetUserEmailById).not.toHaveBeenCalled()
  })

  it('fails fast when an authenticated Sim user has no resolvable email', async () => {
    mockGetUserEmailById.mockRejectedValue(
      new Error('Authenticated user user-1 has no email address')
    )

    await expect(
      resolveStartBlockRunIdentity({
        kind: 'session',
        userId: 'user-1',
        sessionId: 'session-1',
      })
    ).rejects.toThrow('Authenticated user user-1 has no email address')
  })
})
