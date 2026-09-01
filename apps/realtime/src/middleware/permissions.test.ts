/**
 * Tests for socket server permission middleware.
 *
 * Tests cover:
 * - Role-based operation permissions (admin, write, read)
 * - All socket operations
 * - Edge cases and invalid inputs
 */

import { ALL_SOCKET_OPERATIONS, BLOCK_OPERATIONS } from '@sim/realtime-protocol/constants'
import {
  expectPermissionAllowed,
  expectPermissionDenied,
  ROLE_ALLOWED_OPERATIONS,
  SOCKET_OPERATIONS,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorize,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ workspaceId: 'ws-1', name: 'Test Workflow' }]),
        })),
      })),
    })),
  },
}))

import {
  checkRolePermission,
  checkWorkflowOperationPermission,
  resolveCurrentWorkflowRole,
  verifyWorkflowAccess,
} from '@/middleware/permissions'

describe('checkRolePermission', () => {
  describe('admin role', () => {
    it('should allow all operations for admin role', () => {
      const operations = SOCKET_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('admin', operation)
        expectPermissionAllowed(result)
      }
    })

    it('should allow batch-add-blocks operation', () => {
      const result = checkRolePermission('admin', 'batch-add-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow batch-remove-blocks operation', () => {
      const result = checkRolePermission('admin', 'batch-remove-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow update operation', () => {
      const result = checkRolePermission('admin', 'update')
      expectPermissionAllowed(result)
    })

    it('should allow batch-update-positions operation', () => {
      const result = checkRolePermission('admin', 'batch-update-positions')
      expectPermissionAllowed(result)
    })

    it('should allow replace-state operation', () => {
      const result = checkRolePermission('admin', 'replace-state')
      expectPermissionAllowed(result)
    })

    it('should allow subblock-batch-update operation', () => {
      const result = checkRolePermission('admin', 'subblock-batch-update')
      expectPermissionAllowed(result)
    })
  })

  describe('write role', () => {
    it('should allow all operations for write role (same as admin)', () => {
      const operations = SOCKET_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('write', operation)
        expectPermissionAllowed(result)
      }
    })

    it('should allow batch-add-blocks operation', () => {
      const result = checkRolePermission('write', 'batch-add-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow batch-remove-blocks operation', () => {
      const result = checkRolePermission('write', 'batch-remove-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow update-position operation', () => {
      const result = checkRolePermission('write', 'update-position')
      expectPermissionAllowed(result)
    })

    it('should allow subblock-batch-update operation', () => {
      const result = checkRolePermission('write', 'subblock-batch-update')
      expectPermissionAllowed(result)
    })
  })

  describe('read role', () => {
    it('should deny update-position for read role (it persists block coordinates)', () => {
      const result = checkRolePermission('read', 'update-position')
      expectPermissionDenied(result, 'read')
      expectPermissionDenied(result, 'update-position')
    })

    it('should deny batch-add-blocks operation for read role', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expectPermissionDenied(result, 'read')
      expectPermissionDenied(result, 'batch-add-blocks')
    })

    it('should deny batch-remove-blocks operation for read role', () => {
      const result = checkRolePermission('read', 'batch-remove-blocks')
      expectPermissionDenied(result, 'read')
    })

    it('should deny update operation for read role', () => {
      const result = checkRolePermission('read', 'update')
      expectPermissionDenied(result, 'read')
    })

    it('should deny batch-update-positions for read role (it persists block coordinates)', () => {
      const result = checkRolePermission('read', 'batch-update-positions')
      expectPermissionDenied(result, 'read')
      expectPermissionDenied(result, 'batch-update-positions')
    })

    it('should deny replace-state operation for read role', () => {
      const result = checkRolePermission('read', 'replace-state')
      expectPermissionDenied(result, 'read')
    })

    it('should deny subblock-batch-update operation for read role', () => {
      const result = checkRolePermission('read', 'subblock-batch-update')
      expectPermissionDenied(result, 'read')
    })

    it('should deny toggle-enabled operation for read role', () => {
      const result = checkRolePermission('read', 'toggle-enabled')
      expectPermissionDenied(result, 'read')
    })

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

  describe('unknown role', () => {
    it('should deny all operations for unknown role', () => {
      const operations = SOCKET_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('unknown', operation)
        expectPermissionDenied(result)
      }
    })

    it('should deny operations for empty role', () => {
      const result = checkRolePermission('', 'batch-add-blocks')
      expectPermissionDenied(result)
    })
  })

  describe('unknown operations', () => {
    it('should deny unknown operations for admin', () => {
      const result = checkRolePermission('admin', 'unknown-operation')
      expectPermissionDenied(result, 'admin')
      expectPermissionDenied(result, 'unknown-operation')
    })

    it('should deny unknown operations for write', () => {
      const result = checkRolePermission('write', 'unknown-operation')
      expectPermissionDenied(result)
    })

    it('should deny unknown operations for read', () => {
      const result = checkRolePermission('read', 'unknown-operation')
      expectPermissionDenied(result)
    })

    it('should deny empty operation', () => {
      const result = checkRolePermission('admin', '')
      expectPermissionDenied(result)
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

    it('grants read nothing, so it is trivially a subset of write', () => {
      const readAllowed = ALL_SOCKET_OPERATIONS.filter(
        (operation) => checkRolePermission('read', operation).allowed
      )
      expect(readAllowed).toEqual([])
    })

    it('keeps the shared fixture in step with the production ACL', () => {
      // The fixture is a convenience mirror; drift between it and the real table is
      // what made the stale read grants look intentional.
      for (const operation of ALL_SOCKET_OPERATIONS) {
        const fixtureAllows = ROLE_ALLOWED_OPERATIONS.read.includes(
          operation as (typeof ROLE_ALLOWED_OPERATIONS.read)[number]
        )
        expect(fixtureAllows).toBe(checkRolePermission('read', operation).allowed)
      }
    })
  })

  describe('specific operations', () => {
    const testCases = [
      { operation: 'batch-add-blocks', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'batch-remove-blocks',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'update', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-position', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-name', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'toggle-enabled', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-parent', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'update-canonical-mode',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'toggle-handles', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'batch-toggle-locked',
        adminAllowed: true,
        writeAllowed: false, // Admin-only operation
        readAllowed: false,
      },
      {
        operation: 'batch-update-positions',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'replace-state', adminAllowed: true, writeAllowed: true, readAllowed: false },
    ]

    for (const { operation, adminAllowed, writeAllowed, readAllowed } of testCases) {
      it(`should ${adminAllowed ? 'allow' : 'deny'} "${operation}" for admin`, () => {
        const result = checkRolePermission('admin', operation)
        expect(result.allowed).toBe(adminAllowed)
      })

      it(`should ${writeAllowed ? 'allow' : 'deny'} "${operation}" for write`, () => {
        const result = checkRolePermission('write', operation)
        expect(result.allowed).toBe(writeAllowed)
      })

      it(`should ${readAllowed ? 'allow' : 'deny'} "${operation}" for read`, () => {
        const result = checkRolePermission('read', operation)
        expect(result.allowed).toBe(readAllowed)
      })
    }
  })

  describe('reason messages', () => {
    it('should include role in denial reason', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expect(result.reason).toContain("'read'")
    })

    it('should include operation in denial reason', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expect(result.reason).toContain("'batch-add-blocks'")
    })

    it('should have descriptive denial message format', () => {
      const result = checkRolePermission('read', 'remove')
      expect(result.reason).toMatch(/Role '.*' not permitted to perform '.*'/)
    })
  })
})

describe('checkWorkflowOperationPermission', () => {
  const userId = 'user-1'
  let workflowCounter = 0
  let workflowId: string

  beforeEach(() => {
    vi.clearAllMocks()
    // Unique workflowId per test so the module-level role cache never leaks across tests
    workflowCounter += 1
    workflowId = `wf-${workflowCounter}`
  })

  it('allows a write operation when the user still has write access', async () => {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })

    const result = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')

    expect(result.allowed).toBe(true)
    expect(result.role).toBe('write')
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

  it('caches the role within the TTL to avoid a DB read on every operation', async () => {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })

    await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')
    await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')

    expect(mockAuthorize).toHaveBeenCalledTimes(1)
  })

  it('re-reads the role after the cache TTL expires', async () => {
    vi.useFakeTimers()
    try {
      mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })
      await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')

      // Downgraded to read after the first check
      mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'read' })
      vi.advanceTimersByTime(31_000)

      const result = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'write')
      expect(mockAuthorize).toHaveBeenCalledTimes(2)
      expect(result.allowed).toBe(false)
      expect(result.role).toBe('read')
    } finally {
      vi.useRealTimers()
    }
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

  it('uses the last cached role (not the join-time role) on a transient DB error', async () => {
    vi.useFakeTimers()
    try {
      mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })
      await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')

      vi.advanceTimersByTime(31_000)
      mockAuthorize.mockRejectedValue(new Error('db unavailable'))

      // fallbackRole is 'read', but the last recorded decision was 'write' — use that
      const result = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'read')
      expect(result.allowed).toBe(true)
      expect(result.role).toBe('write')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('resolveCurrentWorkflowRole single-flight', () => {
  const userId = 'sf-user-1'
  let workflowCounter = 0
  let workflowId: string

  beforeEach(() => {
    vi.clearAllMocks()
    // Unique workflowId per test so the module-level role cache never leaks across tests
    workflowCounter += 1
    workflowId = `sf-wf-${workflowCounter}`
  })

  it('coalesces concurrent resolutions into a single authorization query', async () => {
    let resolveAuthorize!: (value: { allowed: boolean; workspacePermission: string | null }) => void
    mockAuthorize.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthorize = resolve
      })
    )

    // Both callers race the same expired/cold cache entry; they must share one
    // in-flight query so a slower duplicate can never overwrite a newer
    // decision (e.g. a revocation recorded by the eviction sweep).
    const first = resolveCurrentWorkflowRole(userId, workflowId, 'read')
    const second = resolveCurrentWorkflowRole(userId, workflowId, 'read')

    resolveAuthorize({ allowed: true, workspacePermission: 'write' })

    expect(await first).toBe('write')
    expect(await second).toBe('write')
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
  })

  it('does not coalesce resolutions for different workflows', async () => {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'read' })

    const [first, second] = await Promise.all([
      resolveCurrentWorkflowRole(userId, workflowId, 'read'),
      resolveCurrentWorkflowRole(userId, `${workflowId}-other`, 'read'),
    ])

    expect(first).toBe('read')
    expect(second).toBe('read')
    expect(mockAuthorize).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh query after an in-flight resolution settles and its cache entry expires', async () => {
    vi.useFakeTimers()
    try {
      mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })
      expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBe('write')

      vi.advanceTimersByTime(31_000)
      mockAuthorize.mockResolvedValue({ allowed: false, workspacePermission: null })

      expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBeNull()
      expect(mockAuthorize).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('verifyWorkflowAccess role-cache refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the fresh decision so a stale cached revocation does not block a re-granted join', async () => {
    const userId = 'vw-user-1'
    const workflowId = 'vw-wf-1'

    // A sweep-style resolution records the revocation.
    mockAuthorize.mockResolvedValue({ allowed: false, workspacePermission: null })
    expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBeNull()

    // Access is restored and a fresh join-time verify succeeds.
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'write' })
    const access = await verifyWorkflowAccess(userId, workflowId)
    expect(access.hasAccess).toBe(true)

    // The pre-join gate's warm read now sees the fresh role, not the stale
    // cached null recorded before the re-grant.
    mockAuthorize.mockRejectedValue(new Error('must not re-query'))
    expect(await resolveCurrentWorkflowRole(userId, workflowId, 'read')).toBe('write')
  })

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
