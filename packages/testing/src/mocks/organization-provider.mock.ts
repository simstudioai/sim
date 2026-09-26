import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/app/o/[organizationId]/providers/organization-provider`.
 *
 * Defaults mirror rendering outside an `OrganizationProvider`:
 * - `mockUseOrganizationContext` throws the real "must be used within OrganizationProvider" error,
 *   so a test that renders an organization surface must set the context it needs.
 * - `mockUseOptionalOrganizationContext` returns `null`.
 * - `mockOrganizationProvider` renders its `children`.
 *
 * @example
 * ```ts
 * import { organizationProviderMockFns } from '@sim/testing/mocks/organization-provider.mock'
 *
 * organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
 *   organization: { id: 'org-1', name: 'Acme', logo: null },
 *   viewer: { isAdmin: true },
 * })
 * ```
 */
export const organizationProviderMockFns = {
  mockOrganizationProvider: vi.fn(({ children }: { children?: unknown }): unknown => children),
  mockUseOrganizationContext: vi.fn((): unknown => {
    throw new Error('useOrganizationContext must be used within OrganizationProvider')
  }),
  mockUseOptionalOrganizationContext: vi.fn((): unknown => null),
}

/**
 * Static mock module for `@/app/o/[organizationId]/providers/organization-provider`. Covers every
 * runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
 * ```
 */
export const organizationProviderMock = {
  OrganizationProvider: organizationProviderMockFns.mockOrganizationProvider,
  useOrganizationContext: organizationProviderMockFns.mockUseOrganizationContext,
  useOptionalOrganizationContext: organizationProviderMockFns.mockUseOptionalOrganizationContext,
}
