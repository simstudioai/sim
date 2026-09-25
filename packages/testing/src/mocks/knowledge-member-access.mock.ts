import { vi } from 'vitest'

/** Stand-in for the real `KnowledgeConnectorMemberAccessDeniedError` (real name and ctor). */
export class MockKnowledgeConnectorMemberAccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeConnectorMemberAccessDeniedError'
  }
}

interface MockListingCapMeta {
  permissionScopedListing?: { capFieldIds?: readonly string[] }
  configFields?: ReadonlyArray<{ id: string; title?: string }>
}

function isCapFieldSet(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return false
    const parsed = Number(trimmed)
    return !(Number.isFinite(parsed) && parsed <= 0)
  }
  return true
}

/**
 * Controllable mock functions for `@/lib/knowledge/connectors/member-access`.
 *
 * Defaults: `mockStripListingCapFields` and `mockFindListingCapViolation` port the real pure logic
 * (zero every `capFieldIds` entry / name the set cap fields, `null` when none). Everything else is
 * a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { knowledgeMemberAccessMockFns } from '@sim/testing/mocks/knowledge-member-access.mock'
 *
 * knowledgeMemberAccessMockFns.mockMintKnowledgeConnectorMemberToken.mockResolvedValue({
 *   accessToken: 'member-token',
 * })
 * ```
 */
export const knowledgeMemberAccessMockFns = {
  mockGrantKnowledgeConnectorCredentialAccess: vi.fn(),
  mockRevokeKnowledgeConnectorCredentialAccess: vi.fn(),
  mockAssertKnowledgeConnectorCredentialAccess: vi.fn(),
  mockMintKnowledgeConnectorMemberToken: vi.fn(),
  mockRejectKnowledgeConnectorMemberToken: vi.fn(),
  mockListKnowledgeConnectorMemberCredentials: vi.fn(),
  mockStripListingCapFields: vi.fn(
    (
      connectorMeta: MockListingCapMeta,
      sourceConfig: Record<string, unknown>
    ): Record<string, unknown> => {
      const capFieldIds = connectorMeta.permissionScopedListing?.capFieldIds ?? []
      if (capFieldIds.length === 0) return sourceConfig
      const stripped = { ...sourceConfig }
      for (const fieldId of capFieldIds) stripped[fieldId] = 0
      return stripped
    }
  ),
  mockFindListingCapViolation: vi.fn(
    (connectorMeta: MockListingCapMeta, sourceConfig: Record<string, unknown>): string | null => {
      const capFields = (connectorMeta.permissionScopedListing?.capFieldIds ?? []).filter(
        (fieldId) => isCapFieldSet(sourceConfig[fieldId])
      )
      if (capFields.length === 0) return null
      const titles = capFields.map(
        (fieldId) =>
          connectorMeta.configFields?.find((field) => field.id === fieldId)?.title ?? fieldId
      )
      return `${titles.join(', ')} cannot be set when syncing per member: every member's listing must be complete for their access to be tracked`
    }
  ),
  mockValidateKnowledgeConnectorMembersBinding: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/connectors/member-access`. The error class is
 * {@link MockKnowledgeConnectorMemberAccessDeniedError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/connectors/member-access', () => knowledgeMemberAccessMock)
 * ```
 */
export const knowledgeMemberAccessMock = {
  KnowledgeConnectorMemberAccessDeniedError: MockKnowledgeConnectorMemberAccessDeniedError,
  grantKnowledgeConnectorCredentialAccess:
    knowledgeMemberAccessMockFns.mockGrantKnowledgeConnectorCredentialAccess,
  revokeKnowledgeConnectorCredentialAccess:
    knowledgeMemberAccessMockFns.mockRevokeKnowledgeConnectorCredentialAccess,
  assertKnowledgeConnectorCredentialAccess:
    knowledgeMemberAccessMockFns.mockAssertKnowledgeConnectorCredentialAccess,
  mintKnowledgeConnectorMemberToken:
    knowledgeMemberAccessMockFns.mockMintKnowledgeConnectorMemberToken,
  rejectKnowledgeConnectorMemberToken:
    knowledgeMemberAccessMockFns.mockRejectKnowledgeConnectorMemberToken,
  listKnowledgeConnectorMemberCredentials:
    knowledgeMemberAccessMockFns.mockListKnowledgeConnectorMemberCredentials,
  stripListingCapFields: knowledgeMemberAccessMockFns.mockStripListingCapFields,
  findListingCapViolation: knowledgeMemberAccessMockFns.mockFindListingCapViolation,
  validateKnowledgeConnectorMembersBinding:
    knowledgeMemberAccessMockFns.mockValidateKnowledgeConnectorMembersBinding,
}
