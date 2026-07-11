/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { envRef } = vi.hoisted(() => ({
  envRef: { NODE_ENV: 'development' as string | undefined },
}))

vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
  getEnv: (key: string) => process.env[key],
  isFalsy: (v: unknown) => v === false || v === 'false' || v === '0',
  isTruthy: (v: unknown) => v === true || v === 'true' || v === '1',
}))

import { getDeploymentEnv } from '@/lib/core/config/env-flags'

describe('getDeploymentEnv', () => {
  const ENV_KEYS = [
    'OTEL_DEPLOYMENT_ENVIRONMENT',
    'DEPLOYMENT_ENVIRONMENT',
    'APPCONFIG_ENVIRONMENT',
  ]

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    envRef.NODE_ENV = 'development'
  })

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('resolves the dev tier from OTEL_DEPLOYMENT_ENVIRONMENT=dev', () => {
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'dev'
    expect(getDeploymentEnv()).toBe('development')
  })

  it('resolves the staging tier from OTEL_DEPLOYMENT_ENVIRONMENT=staging', () => {
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'staging'
    expect(getDeploymentEnv()).toBe('staging')
  })

  it('resolves the production tier from OTEL_DEPLOYMENT_ENVIRONMENT=prod', () => {
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'prod'
    expect(getDeploymentEnv()).toBe('production')
  })

  it('maps APPCONFIG_ENVIRONMENT=production to the production tier when OTEL var is unset', () => {
    process.env.APPCONFIG_ENVIRONMENT = 'production'
    expect(getDeploymentEnv()).toBe('production')
  })

  it('falls back to NODE_ENV when no deployment-tier env var is set', () => {
    envRef.NODE_ENV = 'production'
    expect(getDeploymentEnv()).toBe('production')
  })

  it('defaults to development when nothing is set at all', () => {
    envRef.NODE_ENV = undefined
    expect(getDeploymentEnv()).toBe('development')
  })

  it('prefers OTEL_DEPLOYMENT_ENVIRONMENT over DEPLOYMENT_ENVIRONMENT and APPCONFIG_ENVIRONMENT', () => {
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'staging'
    process.env.DEPLOYMENT_ENVIRONMENT = 'prod'
    process.env.APPCONFIG_ENVIRONMENT = 'production'
    expect(getDeploymentEnv()).toBe('staging')
  })

  it('buckets an unrecognized tier value to development rather than throwing', () => {
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'some-future-tier'
    expect(getDeploymentEnv()).toBe('development')
  })
})
