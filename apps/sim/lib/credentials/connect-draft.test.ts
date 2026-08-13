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

  it('refreshes the expiry without changing an active connection intent', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'active-draft-id', expiresAt }])

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
    expect(conflict?.set).not.toHaveProperty('id')
    expect(conflict?.set).not.toHaveProperty('displayName')
    expect(conflict?.set).not.toHaveProperty('credentialId')
    expect(conflict?.setWhere).toBeDefined()
    expect(result).toEqual({ id: 'active-draft-id', expiresAt })
  })

  it('fails fast when an active draft has a different connection intent', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        credentialId: 'credential-1',
        displayName: 'Existing Gmail',
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'A different OAuth connection flow is already active for this provider',
    })
  })
})
