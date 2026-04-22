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
import { describe, expect, it } from 'vitest'
import { checkRolePermission } from '@/socket/middleware/permissions'

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
