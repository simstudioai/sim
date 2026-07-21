/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  buildStripeClientConfig,
  STRIPE_API_VERSION,
  STRIPE_E2E_PROFILE,
  type StripeClientConfigEnvironment,
} from '@/lib/billing/stripe-client-config'

const guardedEnvironment: StripeClientConfigEnvironment = {
  DATABASE_URL: 'postgresql://sim:sim@127.0.0.1:5432/sim_e2e_config_test',
  E2E_PROFILE: STRIPE_E2E_PROFILE,
  STRIPE_API_BASE_URL: 'http://127.0.0.1:12111',
  STRIPE_SECRET_KEY: 'sk_test_e2e_config',
}

describe('buildStripeClientConfig', () => {
  it('preserves the normal Stripe configuration without an override', () => {
    expect(
      buildStripeClientConfig({
        DATABASE_URL: 'postgresql://db.example.com/sim',
        STRIPE_SECRET_KEY: 'sk_live_normal_deployment',
      })
    ).toEqual({
      apiVersion: STRIPE_API_VERSION,
    })
  })

  it('builds an HTTP transport for a guarded loopback fake', () => {
    expect(buildStripeClientConfig(guardedEnvironment)).toEqual({
      apiVersion: STRIPE_API_VERSION,
      host: '127.0.0.1',
      port: '12111',
      protocol: 'http',
    })
  })

  it('uses the HTTP default port when the override omits one', () => {
    expect(
      buildStripeClientConfig({
        ...guardedEnvironment,
        STRIPE_API_BASE_URL: 'http://localhost',
      })
    ).toMatchObject({
      host: 'localhost',
      port: 80,
      protocol: 'http',
    })
  })

  it.each(['sk_test_e2e_config', 'sk_live_e2e_config'])(
    'fails closed when the E2E profile configures %s without an override',
    (stripeSecretKey) => {
      expect(() =>
        buildStripeClientConfig({
          ...guardedEnvironment,
          STRIPE_API_BASE_URL: undefined,
          STRIPE_SECRET_KEY: stripeSecretKey,
        })
      ).toThrow('STRIPE_API_BASE_URL is required')
    }
  )

  it.each([
    {
      name: 'a missing E2E profile',
      environment: { E2E_PROFILE: undefined },
      message: 'requires E2E_PROFILE',
    },
    {
      name: 'a different E2E profile',
      environment: { E2E_PROFILE: 'self-hosted-chromium' },
      message: 'requires E2E_PROFILE',
    },
    {
      name: 'a live Stripe key',
      environment: { STRIPE_SECRET_KEY: 'sk_live_not_redirectable' },
      message: 'requires a Stripe test secret key',
    },
    {
      name: 'a public database',
      environment: { DATABASE_URL: 'postgresql://db.example.com/sim' },
      message: 'requires a guarded sim_e2e_* database',
    },
    {
      name: 'a remote database with an E2E-shaped name',
      environment: { DATABASE_URL: 'postgresql://db.example.com/sim_e2e_config_test' },
      message: 'requires a loopback Postgres database',
    },
    {
      name: 'an empty E2E database suffix',
      environment: { DATABASE_URL: 'postgresql://127.0.0.1/sim_e2e_' },
      message: 'requires a guarded sim_e2e_* database',
    },
    {
      name: 'a malformed database URL',
      environment: { DATABASE_URL: 'not-a-database-url' },
      message: 'requires a guarded sim_e2e_* database',
    },
  ])('rejects an override with $name', ({ environment, message }) => {
    expect(() =>
      buildStripeClientConfig({
        ...guardedEnvironment,
        ...environment,
      })
    ).toThrow(message)
  })

  it.each([
    'https://127.0.0.1:12111',
    'http://stripe.example.com:12111',
    'http://0.0.0.0:12111',
    'http://user:password@127.0.0.1:12111',
    'http://127.0.0.1:12111/v1',
    'http://127.0.0.1:12111?mode=test',
    'http://127.0.0.1:12111#fragment',
    ' http://127.0.0.1:12111',
    'not-a-url',
  ])('rejects an unsafe or malformed override: %s', (stripeApiBaseUrl) => {
    expect(() =>
      buildStripeClientConfig({
        ...guardedEnvironment,
        STRIPE_API_BASE_URL: stripeApiBaseUrl,
      })
    ).toThrow()
  })
})
