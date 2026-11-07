import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/organizations/provider`.
 *
 * Defaults mirror rendering outside an `OrganizationProvider`:
 * - `mockUseOrganization` throws the real "must be used within OrganizationProvider" error,
 *   so a test that renders an organization surface must set the context it needs.
 * - `mockUseOptionalOrganization` returns `null`.
 * - `mockOrganizationProvider` renders its `children`.
 *
 * @example
 * ```ts
 * import { organizationProviderMockFns } from '@sim/testing/mocks/organization-provider.mock'
 *
 * organizationProviderMockFns.mockUseOrganization.mockReturnValue({
 *   organization: { id: 'org-1', name: 'Acme', logo: null },
 *   viewer: { isAdmin: true },
 * })
 * ```
 */
export const organizationProviderMockFns = {
  mockOrganizationProvider: vi.fn(({ children }: { children?: unknown }): unknown => children),
  mockUseOrganization: vi.fn((): unknown => {
    throw new Error('useOrganization must be used within OrganizationProvider')
  }),
  mockUseOptionalOrganization: vi.fn((): unknown => null),
}

/**
 * Static mock module for `@/lib/organizations/provider`. Covers every
 * runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/organizations/provider', () => organizationProviderMock)
 * ```
 */
export const organizationProviderMock = {
  OrganizationProvider: organizationProviderMockFns.mockOrganizationProvider,
  useOrganization: organizationProviderMockFns.mockUseOrganization,
  useOptionalOrganization: organizationProviderMockFns.mockUseOptionalOrganization,
}
