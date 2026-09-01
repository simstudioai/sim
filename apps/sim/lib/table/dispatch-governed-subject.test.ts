/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/events', () => ({
  appendTableEvent: vi.fn(),
}))
vi.mock('@/lib/table/service', () => ({
  getTableById: vi.fn(),
}))

import { insertDispatch } from '@/lib/table/dispatcher'

const BASE = {
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  requestId: 'req-1',
  mode: 'all' as const,
  scope: { groupIds: ['group-1'] },
  isManualRun: true,
}

/** The values `insertDispatch` handed to the single `db.insert(...).values(...)`. */
function insertedRow(): Record<string, unknown> {
  expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
  return dbChainMockFns.values.mock.calls[0][0] as Record<string, unknown>
}

describe('insertDispatch governed subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The bug this replaces: an optional field defaulting to `triggeredByUserId`
   * meant a workspace-key auto-dispatch stored the workspace billed account as
   * its gate subject — a bystander whose tool denylist would then run against
   * a request nobody meant to govern.
   */
  it('stores null for an actorless run even when the attribution names a user', async () => {
    await insertDispatch({
      ...BASE,
      triggeredByUserId: 'billing-owner',
      capabilityGovernedUserId: null,
    })
    const row = insertedRow()
    expect(row.triggeredByUserId).toBe('billing-owner')
    expect(row.capabilityGovernedUserId).toBeNull()
  })

  it('stores the acting person for a session-triggered run', async () => {
    await insertDispatch({
      ...BASE,
      triggeredByUserId: 'user-1',
      capabilityGovernedUserId: 'user-1',
    })
    const row = insertedRow()
    expect(row.capabilityGovernedUserId).toBe('user-1')
  })

  /**
   * The two fields are independent: a delegated run can be metered to the payer
   * while staying governed by the person who asked for it.
   */
  it('keeps the gate subject independent of the meter subject', async () => {
    await insertDispatch({
      ...BASE,
      triggeredByUserId: 'billing-owner',
      capabilityGovernedUserId: 'requesting-user',
    })
    const row = insertedRow()
    expect(row.triggeredByUserId).toBe('billing-owner')
    expect(row.capabilityGovernedUserId).toBe('requesting-user')
  })

  /**
   * A row written before the column existed reads `capability_governed_user_id`
   * as NULL with `triggered_by_user_id` still set. Under the new semantics that
   * shape means "actorless, ungated" — which is why the 0315 migration
   * backfills the legacy subject onto non-terminal pre-migration rows rather
   * than letting them fall through to it.
   */
  it('never reconstructs the gate subject from the attribution', async () => {
    await insertDispatch({
      ...BASE,
      triggeredByUserId: 'user-1',
      capabilityGovernedUserId: null,
    })
    expect(insertedRow().capabilityGovernedUserId).toBeNull()
  })
})
