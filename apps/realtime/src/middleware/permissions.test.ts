/**
 * Tests for socket server permission middleware.
 *
 * Tests cover:
 * - Role-based operation permissions (admin, write, read)
 * - All socket operations
 * - Edge cases and invalid inputs
 */

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

import {
  checkRolePermission,
  checkWorkflowOperationPermission,
  resolveCurrentWorkflowRole,
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
    it('should only allow update-position for read role', () => {
      const result = checkRolePermission('read', 'update-position')
      expectPermissionAllowed(result)
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

    it('should allow batch-update-positions operation for read role', () => {
      const result = checkRolePermission('read', 'batch-update-positions')
      expectPermissionAllowed(result)
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

    it('should deny all write operations for read role', () => {
      const readAllowedOps = ['update-position', 'batch-update-positions']
      const writeOperations = SOCKET_OPERATIONS.filter((op) => !readAllowedOps.includes(op))

      for (const operation of writeOperations) {
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
    it('should verify admin has same permissions as write', () => {
      const adminOps = ROLE_ALLOWED_OPERATIONS.admin
      const writeOps = ROLE_ALLOWED_OPERATIONS.write

      // Admin and write should have same operations
      expect(adminOps).toEqual(writeOps)
    })

    it('should verify read is a subset of write permissions', () => {
      const readOps = ROLE_ALLOWED_OPERATIONS.read
      const writeOps = ROLE_ALLOWED_OPERATIONS.write

      for (const op of readOps) {
        expect(writeOps).toContain(op)
      }
    })

    it('should verify read has minimal permissions', () => {
      const readOps = ROLE_ALLOWED_OPERATIONS.read
      expect(readOps).toHaveLength(2)
      expect(readOps).toContain('update-position')
      expect(readOps).toContain('batch-update-positions')
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
      { operation: 'update-position', adminAllowed: true, writeAllowed: true, readAllowed: true },
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
        readAllowed: true,
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

  it('denies writes after a downgrade to read but still allows position updates', async () => {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: 'read' })

    const denied = await checkWorkflowOperationPermission(userId, workflowId, 'update', 'write')
    expect(denied.allowed).toBe(false)
    expect(denied.role).toBe('read')

    const allowed = await checkWorkflowOperationPermission(
      userId,
      workflowId,
      'update-position',
      'write'
    )
    expect(allowed.allowed).toBe(true)
    expect(allowed.role).toBe('read')
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
