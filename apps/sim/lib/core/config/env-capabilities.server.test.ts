/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import {
  getConfiguredSandboxProviderId,
  getSelectedSandboxProviderId,
  inspectConfiguredOAuthClient,
  requireConfiguredOAuthClient,
} from '@/lib/core/config/env-capabilities.server'

describe('server environment capabilities', () => {
  beforeEach(() => {
    setEnv({
      SHOPIFY_CLIENT_ID: undefined,
      SHOPIFY_CLIENT_SECRET: undefined,
      SLACK_CLIENT_ID: undefined,
      SLACK_CLIENT_SECRET: undefined,
      SANDBOX_PROVIDER: undefined,
      DAYTONA_API_KEY: undefined,
      DAYTONA_FUNCTION_SNAPSHOT_ID: undefined,
    })
  })

  afterAll(resetEnvMock)

  it('inspects partial OAuth configuration without throwing', () => {
    setEnv({ SLACK_CLIENT_ID: 'slack-client' })

    expect(inspectConfiguredOAuthClient('slack')).toEqual({
      state: 'partial',
      missingFields: ['SLACK_CLIENT_SECRET'],
      setupCommand: 'npx sim-setup add integration slack',
    })
  })

  it('fails fast when an OAuth client is absent', () => {
    expect(() => requireConfiguredOAuthClient('shopify')).toThrow(
      'OAuth client shopify is not configured. Run npx sim-setup add integration shopify.'
    )
  })

  it('fails fast when an OAuth client is partially configured', () => {
    setEnv({ SLACK_CLIENT_ID: 'slack-client' })

    expect(() => requireConfiguredOAuthClient('slack')).toThrow(
      'OAuth client slack is partially configured — missing SLACK_CLIENT_SECRET. Run npx sim-setup add integration slack.'
    )
  })

  it('does not expose non-string OAuth values as configured credentials', () => {
    setEnv({
      SHOPIFY_CLIENT_ID: true,
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })

    expect(inspectConfiguredOAuthClient('shopify')).toMatchObject({
      state: 'partial',
      missingFields: ['SHOPIFY_CLIENT_ID'],
    })
    expect(() => requireConfiguredOAuthClient('shopify')).toThrow(/SHOPIFY_CLIENT_ID/)
  })

  it('returns the validated values with capability-specific field types', () => {
    setEnv({
      SHOPIFY_CLIENT_ID: 'shopify-client',
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })

    const configured = requireConfiguredOAuthClient('shopify')

    expect(configured.values).toEqual({
      SHOPIFY_CLIENT_ID: 'shopify-client',
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })
    expectTypeOf(configured.values.SHOPIFY_CLIENT_ID).toEqualTypeOf<string>()
    expectTypeOf(configured.values.SHOPIFY_CLIENT_SECRET).toEqualTypeOf<string>()
  })

  it('selects a sandbox adapter without requiring a Function base', () => {
    setEnv({ SANDBOX_PROVIDER: 'daytona', DAYTONA_API_KEY: 'daytona-key' })

    expect(getSelectedSandboxProviderId()).toBe('daytona')
    expect(() => getConfiguredSandboxProviderId()).toThrow(/DAYTONA_FUNCTION_SNAPSHOT_ID/)
  })

  it('rejects an unknown sandbox provider during selection', () => {
    setEnv({ SANDBOX_PROVIDER: 'modal' })

    expect(() => getSelectedSandboxProviderId()).toThrow(
      'Unknown SANDBOX_PROVIDER "modal". Expected one of: e2b, daytona'
    )
  })
})
