import { vi } from 'vitest'
import { permissionGroupsResolveMockFns } from './permission-groups-resolve.mock'

/** Mirrors `ProviderNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockProviderNotAllowedError extends Error {
  constructor(providerId: string, model: string) {
    super(
      `Provider "${providerId}" is not allowed for model "${model}" based on your permission group settings`
    )
    this.name = 'ProviderNotAllowedError'
  }
}

/** Mirrors `ModelNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockModelNotAllowedError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is not allowed based on your permission group settings`)
    this.name = 'ModelNotAllowedError'
  }
}

/** Mirrors `IntegrationNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockIntegrationNotAllowedError extends Error {
  constructor(blockType: string, reason?: string) {
    super(
      reason
        ? `Integration "${blockType}" is not allowed: ${reason}`
        : `Integration "${blockType}" is not allowed based on your permission group settings`
    )
    this.name = 'IntegrationNotAllowedError'
  }
}

/** Mirrors `ToolNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockToolNotAllowedError extends Error {
  constructor(toolId: string) {
    super(`Tool "${toolId}" is not allowed based on your permission group settings`)
    this.name = 'ToolNotAllowedError'
  }
}

/** Mirrors `McpToolsNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockMcpToolsNotAllowedError extends Error {
  constructor() {
    super('MCP tools are not allowed based on your permission group settings')
    this.name = 'McpToolsNotAllowedError'
  }
}

/** Mirrors `CustomToolsNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockCustomToolsNotAllowedError extends Error {
  constructor() {
    super('Custom tools are not allowed based on your permission group settings')
    this.name = 'CustomToolsNotAllowedError'
  }
}

/** Mirrors `SkillsNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockSkillsNotAllowedError extends Error {
  constructor() {
    super('Skills are not allowed based on your permission group settings')
    this.name = 'SkillsNotAllowedError'
  }
}

/** Mirrors `InvitationsNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockInvitationsNotAllowedError extends Error {
  constructor() {
    super('Invitations are not allowed based on your permission group settings')
    this.name = 'InvitationsNotAllowedError'
  }
}

/** Mirrors `PublicApiNotAllowedError` from `@/ee/access-control/utils/permission-check`. */
export class MockPublicApiNotAllowedError extends Error {
  constructor() {
    super('Public API access is not allowed based on your permission group settings')
    this.name = 'PublicApiNotAllowedError'
  }
}

/**
 * Controllable mock functions for `@/ee/access-control/utils/permission-check`.
 *
 * Every validator is a bare `vi.fn()` resolving `undefined`, which is the real "allowed / access
 * control does not apply" outcome. Make one refuse with
 * `mockRejectedValueOnce(new MockModelNotAllowedError('gpt-x'))`. The re-exported resolution
 * functions (`getUserPermissionConfig`, …) are the SAME `vi.fn()`s as
 * `permissionGroupsResolveMockFns`, exactly as the real module re-exports them.
 *
 * @example
 * ```ts
 * import { permissionCheckMockFns } from '@sim/testing/mocks/permission-check.mock'
 *
 * permissionCheckMockFns.mockValidateInvitationsAllowed.mockRejectedValue(
 *   new MockInvitationsNotAllowedError()
 * )
 * ```
 */
export const permissionCheckMockFns = {
  mockValidatePublicFileSharing: vi.fn(),
  mockValidateChatDeployAuth: vi.fn(),
  mockValidateModelProvider: vi.fn(),
  mockValidateBlockType: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockValidatePublicApiAllowed: vi.fn(),
  mockAssertPermissionsAllowed: vi.fn(),
}

/**
 * Static mock module for `@/ee/access-control/utils/permission-check`, with faithful error classes.
 *
 * @example
 * ```ts
 * vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
 * ```
 */
export const permissionCheckMock = {
  getUserPermissionConfig: permissionGroupsResolveMockFns.mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization:
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  resolveVerifiedUserAccessControlContext:
    permissionGroupsResolveMockFns.mockResolveVerifiedUserAccessControlContext,
  resolveWorkspaceGroup: permissionGroupsResolveMockFns.mockResolveWorkspaceGroup,
  ProviderNotAllowedError: MockProviderNotAllowedError,
  ModelNotAllowedError: MockModelNotAllowedError,
  IntegrationNotAllowedError: MockIntegrationNotAllowedError,
  ToolNotAllowedError: MockToolNotAllowedError,
  McpToolsNotAllowedError: MockMcpToolsNotAllowedError,
  CustomToolsNotAllowedError: MockCustomToolsNotAllowedError,
  SkillsNotAllowedError: MockSkillsNotAllowedError,
  InvitationsNotAllowedError: MockInvitationsNotAllowedError,
  PublicApiNotAllowedError: MockPublicApiNotAllowedError,
  validatePublicFileSharing: permissionCheckMockFns.mockValidatePublicFileSharing,
  validateChatDeployAuth: permissionCheckMockFns.mockValidateChatDeployAuth,
  validateModelProvider: permissionCheckMockFns.mockValidateModelProvider,
  validateBlockType: permissionCheckMockFns.mockValidateBlockType,
  validateInvitationsAllowed: permissionCheckMockFns.mockValidateInvitationsAllowed,
  validatePublicApiAllowed: permissionCheckMockFns.mockValidatePublicApiAllowed,
  assertPermissionsAllowed: permissionCheckMockFns.mockAssertPermissionsAllowed,
}
