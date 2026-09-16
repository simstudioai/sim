/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
} from '@/lib/core/config/deployment-shape'

afterEach(resetEnvFlagsMock)

describe('resolveDeploymentShape', () => {
  it('packages the resolved env flags', () => {
    setEnvFlags({
      isHosted: true,
      isBillingEnabled: true,
      isChatEnabled: false,
      isAzureConfigured: true,
      isSsoEnabled: true,
      isSandboxesEnabled: true,
    })

    expect(resolveDeploymentShape()).toEqual({
      hosted: true,
      billingEnabled: true,
      chatEnabled: false,
      azureConfigured: true,
      cohereConfigured: false,
      features: {
        accessControl: false,
        auditLogs: false,
        customBlocks: false,
        dataDrains: false,
        dataRetention: false,
        inbox: true,
        sandboxes: true,
        scim: false,
        sessionPolicies: true,
        sso: true,
        usageMonitoring: false,
        whitelabeling: true,
      },
    })
  })

  it('reads the flags at call time rather than at module init', () => {
    expect(resolveDeploymentShape().hosted).toBe(false)

    setEnvFlags({ isHosted: true })

    expect(resolveDeploymentShape().hosted).toBe(true)
  })
})

describe('getDeploymentShape on the server', () => {
  it('answers from the env flags and ignores seeding, which is browser-only', () => {
    seedDeploymentShape({ ...resolveDeploymentShape(), hosted: true })

    expect(getDeploymentShape().hosted).toBe(false)
  })
})
