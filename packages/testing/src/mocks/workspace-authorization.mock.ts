import { vi } from 'vitest'

/**
 * Shared shape of the refusals in `@/lib/core/application/workspace-authorization`: `code` is
 * always `'forbidden'`, and the `ForbiddenOperationError` subclasses also carry `detailCode`.
 *
 * These extend plain `Error`, NOT the real `OrchestrationError` / `ForbiddenOperationError` (the
 * mock cannot import app code), so an unmocked `instanceof OrchestrationError` projection —
 * `asOrchestrationError`, `internalOrchestrationErrorPolicy`, the v2 concealment policies — does not
 * recognize them. A test exercising that projection must keep the real module.
 */
class MockWorkspaceRefusal extends Error {
  readonly code = 'forbidden' as const
}

/** Mirrors `InsufficientWorkspacePermissionsError` (`detailCode: 'INSUFFICIENT_WORKSPACE_ROLE'`). */
export class MockInsufficientWorkspacePermissionsError extends MockWorkspaceRefusal {
  readonly detailCode = 'INSUFFICIENT_WORKSPACE_ROLE' as const

  constructor() {
    super('Insufficient workspace permissions')
    this.name = 'InsufficientWorkspacePermissionsError'
  }
}

/** Mirrors `NoWorkspaceAccessError` (no `detailCode`; concealed as a 404 by the real policies). */
export class MockNoWorkspaceAccessError extends MockWorkspaceRefusal {
  constructor() {
    super('Insufficient workspace permissions')
    this.name = 'NoWorkspaceAccessError'
  }
}

/** Mirrors `PersonalApiKeysDisabledError` (`detailCode: 'PERSONAL_API_KEYS_DISABLED'`). */
export class MockPersonalApiKeysDisabledError extends MockWorkspaceRefusal {
  readonly detailCode = 'PERSONAL_API_KEYS_DISABLED' as const

  constructor() {
    super('Personal API keys are not allowed for this workspace')
    this.name = 'PersonalApiKeysDisabledError'
  }
}

/** Mirrors `WorkspaceApiKeyAuthorizationError` (`detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED'`). */
export class MockWorkspaceApiKeyAuthorizationError extends MockWorkspaceRefusal {
  readonly detailCode = 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' as const

  constructor() {
    super('Workspace API key cannot perform this operation')
    this.name = 'WorkspaceApiKeyAuthorizationError'
  }
}

/** Mirrors `WorkspaceApiKeyScopeAuthorizationError` (no `detailCode`). */
export class MockWorkspaceApiKeyScopeAuthorizationError extends MockWorkspaceRefusal {
  constructor() {
    super('Workspace API key cannot access this workspace')
    this.name = 'WorkspaceApiKeyScopeAuthorizationError'
  }
}

/** Mirrors `DelegatedWorkspaceAuthorizationError` (no `detailCode`). */
export class MockDelegatedWorkspaceAuthorizationError extends MockWorkspaceRefusal {
  constructor() {
    super('Delegated workspace access is no longer valid')
    this.name = 'DelegatedWorkspaceAuthorizationError'
  }
}

/** Mirrors `PrincipalKindAuthorizationError` (`detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED'`). */
export class MockPrincipalKindAuthorizationError extends MockWorkspaceRefusal {
  readonly detailCode = 'PRINCIPAL_KIND_NOT_PERMITTED' as const

  constructor(principalKind: string, operationId: string) {
    super(`Principal kind ${principalKind} cannot perform operation ${operationId}`)
    this.name = 'PrincipalKindAuthorizationError'
  }
}

/** Mirrors `DelegatedServiceAuthorizationError` (no `detailCode`). */
export class MockDelegatedServiceAuthorizationError extends MockWorkspaceRefusal {
  constructor(serviceId: string, operationId: string) {
    super(`Delegated service ${serviceId} cannot perform operation ${operationId}`)
    this.name = 'DelegatedServiceAuthorizationError'
  }
}

interface MockGovernedPrincipal {
  kind: string
  userId?: string
  subjectUserId?: string
  serviceId?: string
}

/**
 * Controllable mock functions for `@/lib/core/application/workspace-authorization`.
 *
 * Every guard and authorizer is a bare `vi.fn()` (resolves/returns `undefined`, i.e. allowed)
 * except `mockCapabilityGovernedPrincipalUserId`, a faithful port of the real pure rule: human
 * credentials and `organization_delegated` govern their user, a non-executor delegated principal
 * governs its subject, everything else (workspace keys, system, executor runs) returns `null`.
 *
 * @example
 * ```ts
 * import {
 *   MockInsufficientWorkspacePermissionsError,
 *   workspaceAuthorizationMockFns,
 * } from '@sim/testing/mocks/workspace-authorization.mock'
 *
 * workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockRejectedValue(
 *   new MockInsufficientWorkspacePermissionsError()
 * )
 * ```
 */
export const workspaceAuthorizationMockFns = {
  mockCapabilityGovernedPrincipalUserId: vi.fn(
    (principal: MockGovernedPrincipal): string | null => {
      switch (principal.kind) {
        case 'session':
        case 'personal_api_key':
        case 'oauth_access_token':
          return principal.userId ?? null
        case 'organization_delegated':
          return principal.subjectUserId ?? null
        case 'delegated':
          return principal.serviceId === 'executor' ? null : (principal.subjectUserId ?? null)
        default:
          return null
      }
    }
  ),
  mockRequireAllowedWorkspacePrincipal: vi.fn(),
  mockRequireCliAccessAllowed: vi.fn(),
  mockRequireUserCredentialCapabilities: vi.fn(),
  mockRequirePersonalApiKeysAllowed: vi.fn(),
  mockRequireCurrentHumanRole: vi.fn(),
  mockAuthorizeWorkspaceOperation: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/application/workspace-authorization`. Covers every runtime
 * export; error classes are the `Mock*` mirrors above under their real export names.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
 * ```
 */
export const workspaceAuthorizationMock = {
  capabilityGovernedPrincipalUserId:
    workspaceAuthorizationMockFns.mockCapabilityGovernedPrincipalUserId,
  InsufficientWorkspacePermissionsError: MockInsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError: MockNoWorkspaceAccessError,
  PersonalApiKeysDisabledError: MockPersonalApiKeysDisabledError,
  WorkspaceApiKeyAuthorizationError: MockWorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError: MockWorkspaceApiKeyScopeAuthorizationError,
  DelegatedWorkspaceAuthorizationError: MockDelegatedWorkspaceAuthorizationError,
  PrincipalKindAuthorizationError: MockPrincipalKindAuthorizationError,
  DelegatedServiceAuthorizationError: MockDelegatedServiceAuthorizationError,
  requireAllowedWorkspacePrincipal:
    workspaceAuthorizationMockFns.mockRequireAllowedWorkspacePrincipal,
  requireCliAccessAllowed: workspaceAuthorizationMockFns.mockRequireCliAccessAllowed,
  requireUserCredentialCapabilities:
    workspaceAuthorizationMockFns.mockRequireUserCredentialCapabilities,
  requirePersonalApiKeysAllowed: workspaceAuthorizationMockFns.mockRequirePersonalApiKeysAllowed,
  requireCurrentHumanRole: workspaceAuthorizationMockFns.mockRequireCurrentHumanRole,
  authorizeWorkspaceOperation: workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation,
}
