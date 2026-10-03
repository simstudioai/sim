/**
 * Tests for socket server permission middleware.
 *
 * Tests cover:
 * - Role-based operation permissions (admin, write, read)
 * - All socket operations
 * - Edge cases and invalid inputs
 */

import { ALL_SOCKET_OPERATIONS, BLOCK_OPERATIONS } from '@sim/realtime-protocol/constants'
import { databaseMock, dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { workflowAuthzMock, workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workflow', () => workflowAuthzMock)

vi.mock('@sim/db', () => databaseMock)

import {
  checkRolePermission,
  checkWorkflowOperationPermission,
  resolveCurrentWorkflowRole,
  verifyWorkflowAccess,
} from '@/middleware/permissions'

dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-1', name: 'Test Workflow' }])

const mockAuthorize = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

describe('checkRolePermission', () => {
  describe('read role', () => {
    it('grants the read role NO operation at all', () => {
      // Every operation reaching this gate is persisted, so a read-only member must
      // hold none of them — including the position updates that used to be granted
      // here on the mistaken premise that they were ephemeral cursor sync.
      for (const operation of ALL_SOCKET_OPERATIONS) {
        const result = checkRolePermission('read', operation)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('read')
      }
    })
  })

  describe('permission hierarchy verification', () => {
    // These assert the PRODUCTION ACL over the protocol's complete operation list.
    // They used to compare the shared test fixture against itself, which certified
    // whatever the fixture said — including, for a while, the read-role grants that
    // let a read-only member persist block positions.

    it('grants admin everything write has, plus the admin-only operations', () => {
      for (const operation of ALL_SOCKET_OPERATIONS) {
        if (checkRolePermission('write', operation).allowed) {
          expect(checkRolePermission('admin', operation).allowed).toBe(true)
        }
      }
      // Strictly greater: at least one operation admin holds and write does not.
      const adminOnly = ALL_SOCKET_OPERATIONS.filter(
        (operation) =>
          checkRolePermission('admin', operation).allowed &&
          !checkRolePermission('write', operation).allowed
      )
      expect(adminOnly.length).toBeGreaterThan(0)
    })

    it('grants write every per-block operation the protocol declares', () => {
      // A block operation that reaches this gate is an ordinary editor edit, so the
      // write role must hold all of them. Without this, adding a block setting to
      // the protocol and forgetting the ACL entry fails silently at runtime: the
      // editor applies the change optimistically and the server drops the write.
      const denied = Object.values(BLOCK_OPERATIONS).filter(
        (operation) => !checkRolePermission('write', operation).allowed
      )
      expect(denied).toEqual([])
    })

    it('keeps block locking admin-only', () => {
      expect(checkRolePermission('admin', 'batch-toggle-locked').allowed).toBe(true)
      expect(checkRolePermission('write', 'batch-toggle-locked').allowed).toBe(false)
    })
  })
})

describe('checkWorkflowOperationPermission', () => {
  const userId = 'user-1'
  let workflowCounter = 0
  let workflowId: string

  beforeEach(() => {
    // Unique workflowId per test so the module-level role cache never leaks across tests
    workflowCounter += 1
    workflowId = `wf-${workflowCounter}`
  })

  it('denies all writes once workspace access has been revoked', async () => {
    mockAuthorize.mockResolvedValue({ allowed: false, workspacePermission: null })

    const result = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'write')

    expect(result.allowed).toBe(false)
    expect(result.role).toBeNull()
    expect(result.reason).toMatch(/revoked/i)
  })

  it('denies every persisted operation after a downgrade to read, positions included', async () => {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'read' })

    const denied = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'write')
    expect(denied.allowed).toBe(false)
    expect(denied.role).toBe('read')

    // A committed position update writes workflow_blocks, so a downgraded member
    // loses it too — this used to be allowed and was the escalation path.
    const position = await checkWorkflowOperationPermission(
      userId,
      workflowId,
      'update-position',
      'write'
    )
    expect(position.allowed).toBe(false)
    expect(position.role).toBe('read')

    const batch = await checkWorkflowOperationPermission(
      userId,
      workflowId,
      'batch-update-positions',
      'write'
    )
    expect(batch.allowed).toBe(false)
    expect(batch.role).toBe('read')
  })

  it('falls back to the join-time role on a transient DB error when nothing is cached yet', async () => {
    mockAuthorize.mockRejectedValue(new Error('db unavailable'))

    const result = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'write')

    expect(result.allowed).toBe(true)
    expect(result.role).toBe('write')
  })

  it('preserves a recorded revocation through a later transient DB error', async () => {
    vi.useFakeTimers()
    try {
      // First check records the revocation (null) in the cache
      mockAuthorize.mockResolvedValue({ allowed: false, workspacePermission: null })
      const first = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'admin')
      expect(first.allowed).toBe(false)
      expect(first.role).toBeNull()

      // TTL expires, then the DB blips on the next re-validation. The stale join-time
      // role ('admin') must NOT resurrect access — the recorded revocation wins.
      vi.advanceTimersByTime(31_000)
      mockAuthorize.mockRejectedValue(new Error('db unavailable'))

      const second = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'admin')
      expect(second.allowed).toBe(false)
      expect(second.role).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('verifyWorkflowAccess role-cache refresh', () => {
  it('does not let a stale join-time allow bury a sweep denial that started later', async () => {
    const userId = 'vw-user-3'
    const workflowId = 'vw-wf-3'

    // Hand out a controllable promise per authorization call, so the two reads can be
    // started in one order and settled in the other.
    const settle: Array<(value: { allowed: boolean; workspacePermission: string | null }) => void> =
      []
    mockAuthorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle.push(resolve)
        })
    )

    // A join-style verify starts FIRST (against pre-revocation state) and stalls.
    const staleJoin = verifyWorkflowAccess(userId, workflowId)
    for (let i = 0; i < 10 && settle.length < 1; i++) await Promise.resolve()
    expect(settle).toHaveLength(1)

    // The sweep's authorization starts AFTER it, and stalls too.
    const sweep = resolveCurrentWorkflowRole(userId, workflowId, 'read')
    for (let i = 0; i < 10 && settle.length < 2; i++) await Promise.resolve()
    expect(settle).toHaveLength(2)

    // The sweep's denial lands first, then the older join's allow. Ordering by WRITE
    // time would let the join bury the denial and hand the socket another full TTL of
    // access; ordering by read start keeps the denial in force.
    settle[1]({ allowed: false, workspacePermission: null })
    expect(await sweep).toBeNull()
    settle[0]({ allowed: true, workspacePermission: 'write' })
    await staleJoin

    mockAuthorize.mockRejectedValue(new Error('must not re-query'))
    expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBeNull()
  })

  it('does not let a stale in-flight resolution overwrite a fresher verify decision', async () => {
    const userId = 'vw-user-2'
    const workflowId = 'vw-wf-2'

    // A sweep-style resolution starts against pre-re-grant state and stalls.
    let resolveStaleQuery!: (value: {
      allowed: boolean
      workspacePermission: string | null
    }) => void
    mockAuthorize.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStaleQuery = resolve
      })
    )
    const staleResolution = resolveCurrentWorkflowRole(userId, workflowId, 'read')

    // Access is re-granted and a fresh join-time verify records it mid-flight.
    mockAuthorize.mockResolvedValueOnce({ allowed: true, workspacePermission: 'write' })
    await verifyWorkflowAccess(userId, workflowId)

    // The stale query now completes with the pre-re-grant revocation — it must
    // yield to the fresher recorded decision, not overwrite it.
    resolveStaleQuery({ allowed: false, workspacePermission: null })
    expect(await staleResolution).toBe('write')

    mockAuthorize.mockRejectedValue(new Error('must not re-query'))
    expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBe('write')
  })
})
