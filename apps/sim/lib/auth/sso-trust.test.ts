/**
 * @vitest-environment node
 *
 * Locks the SSO linking trust model. Better Auth's account-link gate is
 * `!isTrustedProvider && !userInfo.emailVerified`, so a truthy
 * `trustEmailVerified` lets any registered IdP assert an out-of-domain address
 * as verified and auto-link into that user's account, bypassing the
 * domain-verification proof entirely.
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, expect, it, vi } from 'vitest'

// Structurally slow — it imports the entire Better Auth module graph — so under a fully-parallel local run this file
// blows the default timeout while passing in isolation and on CI. Give it a
// real budget instead of letting machine load decide the verdict.
vi.setConfig({ testTimeout: 30_000 })

const { ssoOptions } = vi.hoisted(() => ({
  ssoOptions: { current: undefined as Record<string, unknown> | undefined },
}))

vi.mock('@better-auth/sso', () => ({
  sso: (options: Record<string, unknown>) => {
    ssoOptions.current = options
    return { id: 'sso' }
  },
}))

setEnvFlags({ isSsoEnabled: true })

afterAll(resetEnvFlagsMock)

it('never trusts the IdP-supplied email_verified claim for SSO linking', async () => {
  await import('@/lib/auth/auth')

  expect(ssoOptions.current).toBeDefined()
  expect(ssoOptions.current?.trustEmailVerified).toBe(false)
})

it('keeps domain verification as the sole SSO linking trust source', async () => {
  await import('@/lib/auth/auth')

  expect(ssoOptions.current?.domainVerification).toEqual({ enabled: true })
})
