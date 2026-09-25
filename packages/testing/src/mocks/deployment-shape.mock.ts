import { vi } from 'vitest'

/** Shape of `DeploymentShape` from `@/lib/api/contracts/workspaces`. */
export interface MockDeploymentShape {
  hosted: boolean
  billingEnabled: boolean
  chatEnabled: boolean
  azureConfigured: boolean
  cohereConfigured: boolean
  features: {
    liveEnterpriseSearch?: boolean
    accessControl: boolean
    auditLogs: boolean
    customBlocks: boolean
    dataDrains: boolean
    dataRetention: boolean
    inbox: boolean
    sandboxes: boolean
    scim: boolean
    sessionPolicies: boolean
    sso: boolean
    usageMonitoring: boolean
    whitelabeling: boolean
  }
}

/**
 * Builds a deployment shape from the `env-flags` mock defaults (self-hosted, billing off, Chat on,
 * inbox/whitelabeling/session policies on, everything else off), with shallow `features` overrides.
 */
export function createMockDeploymentShape(
  overrides: Partial<Omit<MockDeploymentShape, 'features'>> & {
    features?: Partial<MockDeploymentShape['features']>
  } = {}
): MockDeploymentShape {
  const { features, ...rest } = overrides
  return {
    hosted: false,
    billingEnabled: false,
    chatEnabled: true,
    azureConfigured: false,
    cohereConfigured: false,
    ...rest,
    features: {
      liveEnterpriseSearch: false,
      accessControl: false,
      auditLogs: false,
      customBlocks: false,
      dataDrains: false,
      dataRetention: false,
      inbox: true,
      sandboxes: false,
      scim: false,
      sessionPolicies: true,
      sso: false,
      usageMonitoring: false,
      whitelabeling: true,
      ...features,
    },
  }
}

const defaultDeploymentShape = createMockDeploymentShape()

/**
 * Controllable mock functions for `@/lib/core/config/deployment-shape`.
 *
 * Defaults: `mockResolveDeploymentShape`, `mockGetDeploymentShape` and `mockUseDeploymentShape`
 * return one shared, stable {@link createMockDeploymentShape} default (stable so it is safe as a
 * memo dependency, like the real hook). `mockSeedDeploymentShape` and `mockResetDeploymentShape`
 * are no-ops.
 *
 * @example
 * ```ts
 * import {
 *   createMockDeploymentShape,
 *   deploymentShapeMockFns,
 * } from '@sim/testing/mocks/deployment-shape.mock'
 *
 * deploymentShapeMockFns.mockUseDeploymentShape.mockReturnValue(
 *   createMockDeploymentShape({ hosted: true })
 * )
 * ```
 */
export const deploymentShapeMockFns = {
  mockResolveDeploymentShape: vi.fn((): MockDeploymentShape => defaultDeploymentShape),
  mockSeedDeploymentShape: vi.fn((_shape: unknown): void => {}),
  mockResetDeploymentShape: vi.fn((): void => {}),
  mockGetDeploymentShape: vi.fn((): MockDeploymentShape => defaultDeploymentShape),
  mockUseDeploymentShape: vi.fn((): MockDeploymentShape => defaultDeploymentShape),
}

/**
 * Static mock module for `@/lib/core/config/deployment-shape`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)
 * ```
 */
export const deploymentShapeMock = {
  resolveDeploymentShape: deploymentShapeMockFns.mockResolveDeploymentShape,
  seedDeploymentShape: deploymentShapeMockFns.mockSeedDeploymentShape,
  resetDeploymentShape: deploymentShapeMockFns.mockResetDeploymentShape,
  getDeploymentShape: deploymentShapeMockFns.mockGetDeploymentShape,
  useDeploymentShape: deploymentShapeMockFns.mockUseDeploymentShape,
}
