/**
 * Recording a deleted account's identities is an anti-abuse write inside the
 * holder's erasure transaction. It must never become a way to block the erasure.
 */
import { db } from '@sim/db'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordDeletedAccountIdentities } from '@/lib/users/deleted-identity'

describe('recordDeletedAccountIdentities', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    queueTableRows(schemaMock.user, [{ email: 'ada@example.com', emailVerified: true }])
  })

  afterEach(() => {
    resetEnvFlagsMock()
  })

  it('never fails the deletion when the identity write fails', async () => {
    dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(new Error('lock timeout'))

    await expect(recordDeletedAccountIdentities(db, 'user-1')).resolves.toBeUndefined()
    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalled()
  })
})
