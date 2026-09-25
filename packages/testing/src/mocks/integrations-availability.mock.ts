import { vi } from 'vitest'

const mockIsOAuthServiceDeploymentAvailable = vi.fn((_serviceId: string): boolean => true)

/**
 * Controllable mock functions for `@/lib/integrations/availability.server`.
 *
 * Defaults: every integration and OAuth service is available in the deployment.
 * - `mockGetIntegrationAvailability` returns `[]`.
 * - `mockIsIntegrationDeploymentAvailable`, `mockIsIntegrationDeploymentAvailableForVisibility`,
 *   `mockIsOAuthServiceDeploymentAvailable` return `true`.
 * - `mockGetOAuthServiceAvailability` is the real projection: keeps `authType === 'oauth'`
 *   services and asks `mockIsOAuthServiceDeploymentAvailable` for each.
 *
 * @example
 * ```ts
 * import { integrationsAvailabilityMockFns } from '@sim/testing/mocks/integrations-availability.mock'
 *
 * integrationsAvailabilityMockFns.mockIsIntegrationDeploymentAvailableForVisibility.mockImplementation(
 *   (blockType) => blockType !== 'slack'
 * )
 * ```
 */
export const integrationsAvailabilityMockFns = {
  mockGetIntegrationAvailability: vi.fn((): unknown[] => []),
  mockGetOAuthServiceAvailability: vi.fn(
    (
      services: readonly { providerId: string; authType?: string }[]
    ): { providerId: string; available: boolean }[] =>
      services
        .filter((service) => service.authType === 'oauth')
        .map((service) => ({
          providerId: service.providerId,
          available: mockIsOAuthServiceDeploymentAvailable(service.providerId),
        }))
  ),
  mockIsIntegrationDeploymentAvailable: vi.fn((_blockType: string): boolean => true),
  mockIsIntegrationDeploymentAvailableForVisibility: vi.fn(
    (_blockType: string, _visibility: unknown): boolean => true
  ),
  mockIsOAuthServiceDeploymentAvailable,
}

/**
 * Static mock module for `@/lib/integrations/availability.server`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)
 * ```
 */
export const integrationsAvailabilityMock = {
  getIntegrationAvailability: integrationsAvailabilityMockFns.mockGetIntegrationAvailability,
  getOAuthServiceAvailability: integrationsAvailabilityMockFns.mockGetOAuthServiceAvailability,
  isIntegrationDeploymentAvailable:
    integrationsAvailabilityMockFns.mockIsIntegrationDeploymentAvailable,
  isIntegrationDeploymentAvailableForVisibility:
    integrationsAvailabilityMockFns.mockIsIntegrationDeploymentAvailableForVisibility,
  isOAuthServiceDeploymentAvailable:
    integrationsAvailabilityMockFns.mockIsOAuthServiceDeploymentAvailable,
}
