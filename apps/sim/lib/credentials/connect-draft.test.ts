/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateId } = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({ generateId: mockGenerateId }))

import { createConnectDraft } from '@/lib/credentials/connect-draft'

describe('createConnectDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGenerateId.mockReturnValue('new-draft-id')
  })

  it('supersedes an active connection intent with a new exact draft id', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt }])

    const result = await createConnectDraft({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      displayName: 'Work Gmail',
    })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-draft-id' })
    )
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0] as
      | { set?: Record<string, unknown>; setWhere?: unknown }
      | undefined
    expect(conflict?.set).toEqual(
      expect.objectContaining({
        id: 'new-draft-id',
        displayName: 'Work Gmail',
        credentialId: null,
      })
    )
    expect(conflict?.setWhere).toBeUndefined()
    expect(result).toEqual({ id: 'new-draft-id', expiresAt })
  })

  it('supersedes a reconnect target when its mutable display name changes', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt }])

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        credentialId: 'credential-1',
        displayName: 'Renamed Gmail',
      })
    ).resolves.toEqual({ id: 'new-draft-id', expiresAt })

    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          id: 'new-draft-id',
          displayName: 'Renamed Gmail',
          credentialId: 'credential-1',
        }),
      })
    )
  })

  it('fails when the draft upsert does not return a row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        credentialId: 'credential-1',
        displayName: 'Existing Gmail',
      })
    ).rejects.toThrow('Failed to create OAuth credential draft')
  })
})
