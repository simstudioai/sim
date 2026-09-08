/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import type { Session } from 'better-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isBlocked } = vi.hoisted(() => ({ isBlocked: vi.fn() }))

vi.mock('@/lib/auth/access-control', () => ({
  getAccessControlConfig: async () => ({ blockedEmails: [], blockedSignupDomains: [] }),
  isEmailBlockedByAccessControl: isBlocked,
}))

import { runWithAuthDatabase } from '@/lib/auth/database-context'
import { prepareSessionForCreation } from '@/lib/auth/session-hooks'
import { invalidateSessionPolicyCache } from '@/lib/auth/session-policy'

const createdAt = new Date('2026-09-08T00:00:00Z')
const session: Session = {
  id: 'session-1',
  userId: 'user-1',
  token: 'session-token',
  createdAt,
  updatedAt: createdAt,
  expiresAt: new Date('2026-10-08T00:00:00Z'),
}

function transactionExecutor() {
  const limit = vi.fn()
  return {
    limit,
    executor: {
      ...db,
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit }) }) }),
    },
  }
}

describe('prepareSessionForCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isBillingEnabled: true, isHosted: true, isAccessControlEnabled: false })
    invalidateSessionPolicyCache('org-1')
    isBlocked.mockReturnValue(false)
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('Global database read inside the auth transaction')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetEnvFlagsMock()
  })

  it('reads an uncommitted signup account without checking out another connection', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'new@example.com', suspendedAt: null }])
    limit.mockResolvedValueOnce([])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).resolves.toEqual({ data: session })
    expect(db.select).not.toHaveBeenCalled()
  })

  it('clamps a member session using transaction-scoped policy, billing block, and plan reads', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'member@example.com', suspendedAt: null }])
    limit.mockResolvedValueOnce([{ organizationId: 'org-1' }])
    limit.mockResolvedValueOnce([{ settings: { maxSessionHours: 24 } }])
    limit.mockResolvedValueOnce([{ userId: 'owner-1' }])
    limit.mockResolvedValueOnce([{ billingBlocked: false, billingBlockedReason: null }])
    limit.mockResolvedValueOnce([{ plan: 'enterprise', status: 'active' }])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).resolves.toEqual({
      data: {
        ...session,
        activeOrganizationId: 'org-1',
        expiresAt: new Date('2026-09-09T00:00:00Z'),
      },
    })
    expect(limit).toHaveBeenCalledTimes(6)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('refuses a suspended account before it can receive a session', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'member@example.com', suspendedAt: createdAt }])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(limit).toHaveBeenCalledTimes(1)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('keeps the blocked-email gate outside the optional membership lookup', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'blocked@example.com', suspendedAt: null }])
    isBlocked.mockReturnValue(true)

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(limit).toHaveBeenCalledTimes(1)
  })
})
