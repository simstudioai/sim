import { vi } from 'vitest'

const MANAGED_CREDENTIAL_TYPES = ['managed_oauth', 'managed_mcp'] as const

const SHARED_CREDENTIAL_TYPES = [
  'oauth',
  'managed_oauth',
  'managed_mcp',
  'env_workspace',
  'service_account',
] as const

function isManagedCredentialType(type: string): boolean {
  return (MANAGED_CREDENTIAL_TYPES as readonly string[]).includes(type)
}

function isSharedCredentialType(type: string): boolean {
  return type !== 'env_personal' && type !== 'personal_token'
}

interface MockCredentialUseAccess {
  hasWorkspaceAccess: boolean
  member: unknown
  isAdmin: boolean
}

/**
 * Controllable mock functions for `@/lib/credentials/access`.
 *
 * The pure helpers port the real logic: `mockIsManagedCredentialType`,
 * `mockRequireOrdinaryCredentialType` (throws for managed types, else returns the type),
 * `mockIsSharedCredentialType`, `mockDeriveCredentialAdmin` and `mockCanUseCredential`
 * (`hasWorkspaceAccess && (member || isAdmin)`). The loaders `mockGetCredentialActorContext`,
 * `mockResolveCredentialTokenIdentity` and `mockRevokeWorkspaceCredentialMembershipsTx` are bare.
 *
 * @example
 * ```ts
 * import { credentialsAccessMockFns } from '@sim/testing/mocks/credentials-access.mock'
 *
 * credentialsAccessMockFns.mockGetCredentialActorContext.mockResolvedValue({
 *   credential, member: null, hasWorkspaceAccess: true, canWriteWorkspace: true, isAdmin: true,
 * })
 * ```
 */
export const credentialsAccessMockFns = {
  mockIsManagedCredentialType: vi.fn(isManagedCredentialType),
  mockRequireOrdinaryCredentialType: vi.fn((type: string): string => {
    if (isManagedCredentialType(type)) {
      throw new Error('Managed credential reached an ordinary credential surface')
    }
    return type
  }),
  mockResolveCredentialTokenIdentity: vi.fn(),
  mockIsSharedCredentialType: vi.fn(isSharedCredentialType),
  mockDeriveCredentialAdmin: vi.fn(
    (params: {
      credentialType: string
      memberRole: string | null | undefined
      workspaceCanAdmin: boolean
    }): boolean =>
      params.memberRole === 'admin' ||
      (isSharedCredentialType(params.credentialType) && params.workspaceCanAdmin)
  ),
  mockCanUseCredential: vi.fn(
    (access: MockCredentialUseAccess): boolean =>
      access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin)
  ),
  mockGetCredentialActorContext: vi.fn(),
  mockRevokeWorkspaceCredentialMembershipsTx: vi.fn(),
}

/**
 * Static mock module for `@/lib/credentials/access`. `MANAGED_CREDENTIAL_TYPES` and
 * `SHARED_CREDENTIAL_TYPES` carry the real values (every `credential_type` enum value except
 * `env_personal` and `personal_token`).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
 * ```
 */
export const credentialsAccessMock = {
  MANAGED_CREDENTIAL_TYPES,
  SHARED_CREDENTIAL_TYPES,
  isManagedCredentialType: credentialsAccessMockFns.mockIsManagedCredentialType,
  requireOrdinaryCredentialType: credentialsAccessMockFns.mockRequireOrdinaryCredentialType,
  resolveCredentialTokenIdentity: credentialsAccessMockFns.mockResolveCredentialTokenIdentity,
  isSharedCredentialType: credentialsAccessMockFns.mockIsSharedCredentialType,
  deriveCredentialAdmin: credentialsAccessMockFns.mockDeriveCredentialAdmin,
  canUseCredential: credentialsAccessMockFns.mockCanUseCredential,
  getCredentialActorContext: credentialsAccessMockFns.mockGetCredentialActorContext,
  revokeWorkspaceCredentialMembershipsTx:
    credentialsAccessMockFns.mockRevokeWorkspaceCredentialMembershipsTx,
}
