import { vi } from 'vitest'

/**
 * Mirrors `ResourcePolicyNotFoundError` from `@/lib/resource-policies/repository`: same
 * `(resourceType, resourceId)` constructor, `name`, and message.
 */
export class MockResourcePolicyNotFoundError extends Error {
  constructor(resourceType: string, resourceId: string) {
    super(`Required resource policy is missing for ${resourceType} ${resourceId}`)
    this.name = 'ResourcePolicyNotFoundError'
  }
}

/**
 * Mirrors `ResourcePolicyRevisionConflictError` from `@/lib/resource-policies/repository`: same
 * `name` and message.
 */
export class MockResourcePolicyRevisionConflictError extends Error {
  constructor() {
    super('Resource policy changed while it was being edited')
    this.name = 'ResourcePolicyRevisionConflictError'
  }
}

/**
 * Controllable mock functions for `@/lib/resource-policies/repository`. Every function is a bare
 * `vi.fn()` (returns `undefined`).
 *
 * @example
 * ```ts
 * import { resourcePolicyRepositoryMockFns } from '@sim/testing/mocks/resource-policy-repository.mock'
 *
 * resourcePolicyRepositoryMockFns.mockRequireResourcePolicy.mockResolvedValue({ revision: 1, document })
 * ```
 */
export const resourcePolicyRepositoryMockFns = {
  mockRequireResourcePolicy: vi.fn(),
  mockWriteResourcePolicy: vi.fn(),
  mockDeleteResourcePolicyForResource: vi.fn(),
}

/**
 * Static mock module for `@/lib/resource-policies/repository`, exposing
 * {@link MockResourcePolicyNotFoundError} and {@link MockResourcePolicyRevisionConflictError}
 * under the real class names.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)
 * ```
 */
export const resourcePolicyRepositoryMock = {
  ResourcePolicyNotFoundError: MockResourcePolicyNotFoundError,
  ResourcePolicyRevisionConflictError: MockResourcePolicyRevisionConflictError,
  requireResourcePolicy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  writeResourcePolicy: resourcePolicyRepositoryMockFns.mockWriteResourcePolicy,
  deleteResourcePolicyForResource:
    resourcePolicyRepositoryMockFns.mockDeleteResourcePolicyForResource,
}
