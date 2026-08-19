/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserProfile, mockDeleteUserAccount, mockGetAccountDeletionPlan } = vi.hoisted(
  () => ({
    mockGetUserProfile: vi.fn(),
    mockDeleteUserAccount: vi.fn(),
    mockGetAccountDeletionPlan: vi.fn(),
  })
)

vi.mock('@/lib/users/queries', () => ({ getUserProfile: mockGetUserProfile }))
vi.mock('@/lib/users/account-deletion', () => ({
  deleteUserAccount: mockDeleteUserAccount,
  getAccountDeletionPlan: mockGetAccountDeletionPlan,
}))

import { deleteAccountUseCase } from '@/lib/users/application/delete-account'

const SESSION = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const EMPTY_PLAN = { blockers: [], workspacesToDelete: [], workspacesToTransfer: [] }

describe('deleteAccountUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserProfile.mockResolvedValue({ id: 'user-1', email: 'Ada@Example.com' })
    mockDeleteUserAccount.mockResolvedValue(EMPTY_PLAN)
  })

  it('deletes when the confirmation matches the account email, ignoring case and padding', async () => {
    await deleteAccountUseCase.execute({
      principal: SESSION,
      input: { confirmEmail: '  ada@example.com ' },
    })

    expect(mockDeleteUserAccount).toHaveBeenCalledWith('user-1')
  })

  it('refuses a confirmation that names a different address', async () => {
    await expect(
      deleteAccountUseCase.execute({
        principal: SESSION,
        input: { confirmEmail: 'someone-else@example.com' },
      })
    ).rejects.toThrow(/account email/i)

    expect(mockDeleteUserAccount).not.toHaveBeenCalled()
  })

  it('refuses any principal that is not a first-party session', async () => {
    await expect(
      deleteAccountUseCase.execute({
        principal: { kind: 'api-key', userId: 'user-1' } as never,
        input: { confirmEmail: 'ada@example.com' },
      })
    ).rejects.toThrow(/session/i)

    expect(mockGetUserProfile).not.toHaveBeenCalled()
    expect(mockDeleteUserAccount).not.toHaveBeenCalled()
  })
})
