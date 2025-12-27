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

    it('should allow add operation', () => {
      const result = checkRolePermission('admin', 'add')
      expectPermissionAllowed(result)
    })

    it('should allow remove operation', () => {
      const result = checkRolePermission('admin', 'remove')
      expectPermissionAllowed(result)
    })

    it('should allow update operation', () => {
      const result = checkRolePermission('admin', 'update')
      expectPermissionAllowed(result)
    })

    it('should allow duplicate operation', () => {
      const result = checkRolePermission('admin', 'duplicate')
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

    it('should allow add operation', () => {
      const result = checkRolePermission('write', 'add')
      expectPermissionAllowed(result)
    })

    it('should allow remove operation', () => {
      const result = checkRolePermission('write', 'remove')
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

    it('should deny add operation for read role', () => {
      const result = checkRolePermission('read', 'add')
      expectPermissionDenied(result, 'read')
      expectPermissionDenied(result, 'add')
    })

    it('should deny remove operation for read role', () => {
      const result = checkRolePermission('read', 'remove')
      expectPermissionDenied(result, 'read')
    })

    it('should deny update operation for read role', () => {
      const result = checkRolePermission('read', 'update')
      expectPermissionDenied(result, 'read')
    })

    it('should deny duplicate operation for read role', () => {
      const result = checkRolePermission('read', 'duplicate')
      expectPermissionDenied(result, 'read')
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
      const writeOperations = SOCKET_OPERATIONS.filter((op) => op !== 'update-position')

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
      const result = checkRolePermission('', 'add')
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
      expect(readOps).toHaveLength(1)
      expect(readOps).toContain('update-position')
    })
  })

  describe('specific operations', () => {
    const testCases = [
      { operation: 'add', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'remove', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-position', adminAllowed: true, writeAllowed: true, readAllowed: true },
      { operation: 'update-name', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'toggle-enabled', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-parent', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-wide', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'update-advanced-mode',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      {
        operation: 'update-trigger-mode',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'toggle-handles', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'duplicate', adminAllowed: true, writeAllowed: true, readAllowed: false },
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
      const result = checkRolePermission('read', 'add')
      expect(result.reason).toContain("'read'")
    })

    it('should include operation in denial reason', () => {
      const result = checkRolePermission('read', 'add')
      expect(result.reason).toContain("'add'")
    })

    it('should have descriptive denial message format', () => {
      const result = checkRolePermission('read', 'remove')
      expect(result.reason).toMatch(/Role '.*' not permitted to perform '.*'/)
    })
  })
})
