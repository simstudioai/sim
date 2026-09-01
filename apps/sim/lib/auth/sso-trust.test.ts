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
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

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

/**
 * Structurally slow — it imports the entire Better Auth module graph — so under
 * a fully-parallel local run this import blows the default budget while passing
 * in isolation and on CI. The plugin options are captured once at module
 * evaluation, so every assertion reads the same object: import once, outside
 * any per-test budget, with a real budget of its own instead of letting machine
 * load decide the verdict.
 */
beforeAll(async () => {
  await import('@/lib/auth/auth')
}, 30_000)

afterAll(resetEnvFlagsMock)

it('never trusts the IdP-supplied email_verified claim for SSO linking', () => {
  expect(ssoOptions.current).toBeDefined()
  expect(ssoOptions.current?.trustEmailVerified).toBe(false)
})

it('keeps domain verification as the sole SSO linking trust source', () => {
  expect(ssoOptions.current?.domainVerification).toEqual({ enabled: true })
})

it('disables Better Auth membership writes so Sim owns JIT admission', () => {
  expect(ssoOptions.current?.organizationProvisioning).toEqual({
    disabled: true,
    defaultRole: 'member',
  })
})
