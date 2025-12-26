import { expect } from 'vitest'
import type { PermissionType } from '../factories/permission.factory'

/**
 * Asserts that a permission check result is allowed.
 */
export function expectPermissionAllowed(result: { allowed: boolean; reason?: string }): void {
  expect(result.allowed).toBe(true)
  expect(result.reason).toBeUndefined()
}

/**
 * Asserts that a permission check result is denied with a specific reason pattern.
 */
export function expectPermissionDenied(
  result: { allowed: boolean; reason?: string },
  reasonPattern?: string | RegExp
): void {
  expect(result.allowed).toBe(false)
  expect(result.reason).toBeDefined()
  if (reasonPattern) {
    if (typeof reasonPattern === 'string') {
      expect(result.reason).toContain(reasonPattern)
    } else {
      expect(result.reason).toMatch(reasonPattern)
    }
  }
}

/**
 * Asserts that a workflow validation result indicates success.
 */
export function expectWorkflowAccessGranted(result: {
  error: { message: string; status: number } | null
  session: unknown
  workflow: unknown
}): void {
  expect(result.error).toBeNull()
  expect(result.session).not.toBeNull()
  expect(result.workflow).not.toBeNull()
}

/**
 * Asserts that a workflow validation result indicates access denied.
 */
export function expectWorkflowAccessDenied(
  result: {
    error: { message: string; status: number } | null
    session: unknown
    workflow: unknown
  },
  expectedStatus: 401 | 403 | 404 = 403
): void {
  expect(result.error).not.toBeNull()
  expect(result.error?.status).toBe(expectedStatus)
  expect(result.session).toBeNull()
  expect(result.workflow).toBeNull()
}

/**
 * Asserts that a user has a specific permission level.
 */
export function expectUserHasPermission(
  permissions: Array<{ userId: string; permissionType: PermissionType }>,
  userId: string,
  expectedPermission: PermissionType
): void {
  const userPermission = permissions.find((p) => p.userId === userId)
  expect(userPermission).toBeDefined()
  expect(userPermission?.permissionType).toBe(expectedPermission)
}

/**
 * Asserts that a user has no permission.
 */
export function expectUserHasNoPermission(
  permissions: Array<{ userId: string; permissionType: PermissionType }>,
  userId: string
): void {
  const userPermission = permissions.find((p) => p.userId === userId)
  expect(userPermission).toBeUndefined()
}

/**
 * Asserts that a role can perform an operation.
 */
export function expectRoleCanPerform(
  checkFn: (role: string, operation: string) => { allowed: boolean },
  role: string,
  operation: string
): void {
  const result = checkFn(role, operation)
  expect(result.allowed).toBe(true)
}

/**
 * Asserts that a role cannot perform an operation.
 */
export function expectRoleCannotPerform(
  checkFn: (role: string, operation: string) => { allowed: boolean },
  role: string,
  operation: string
): void {
  const result = checkFn(role, operation)
  expect(result.allowed).toBe(false)
}

/**
 * Asserts socket workflow access is granted.
 */
export function expectSocketAccessGranted(result: {
  hasAccess: boolean
  role?: string
  workspaceId?: string
}): void {
  expect(result.hasAccess).toBe(true)
  expect(result.role).toBeDefined()
}

/**
 * Asserts socket workflow access is denied.
 */
export function expectSocketAccessDenied(result: {
  hasAccess: boolean
  role?: string
  workspaceId?: string
}): void {
  expect(result.hasAccess).toBe(false)
  expect(result.role).toBeUndefined()
}

/**
 * Asserts API key authentication succeeded.
 */
export function expectApiKeyValid(result: boolean): void {
  expect(result).toBe(true)
}

/**
 * Asserts API key authentication failed.
 */
export function expectApiKeyInvalid(result: boolean): void {
  expect(result).toBe(false)
}
