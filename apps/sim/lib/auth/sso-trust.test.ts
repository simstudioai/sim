/**
 * Locks the SSO linking trust model. Better Auth's account-link gate is
 * `!isTrustedProvider && !userInfo.emailVerified`, so a truthy
 * `trustEmailVerified` lets any registered IdP assert an out-of-domain address
 * as verified and auto-link into that user's account, bypassing the
 * domain-verification proof entirely.
 */
import { expect, it, vi } from 'vitest'

const { ssoOptions } = vi.hoisted(() => ({
  ssoOptions: { current: undefined as Record<string, unknown> | undefined },
}))

vi.mock('@better-auth/sso', () => ({
  sso: (options: Record<string, unknown>) => {
    ssoOptions.current = options
    return { id: 'sso' }
  },
}))

import '@/lib/auth/sso/plugin'

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
