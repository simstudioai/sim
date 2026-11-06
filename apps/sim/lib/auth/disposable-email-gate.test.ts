import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { admin } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'
import { DISPOSABLE_EMAIL_ERROR_CODE } from '@/lib/auth/constants'
import { refuseDisposableAccountEmail } from '@/lib/auth/disposable-email-gate'
import { configuredSsoPlugin } from '@/lib/auth/sso/plugin'

/**
 * A real Better Auth instance wired the way `auth.ts` wires the gate, so the endpoint path each
 * creation path reports to `databaseHooks.user.create.before` is Better Auth's, not an assumption.
 */
function createAuth() {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'disposable-email-gate-test-secret-0123456789',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    plugins: [admin()],
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            await refuseDisposableAccountEmail(user.email, context?.path)
            return { data: user }
          },
        },
      },
    },
  })
}

const password = 'correct-horse-battery-staple'

describe('refuseDisposableAccountEmail', () => {
  it('refuses a self-service email signup from a disposable domain', async () => {
    const auth = createAuth()
    await expect(
      auth.api.signUpEmail({ body: { email: 'jane@mailinator.com', password, name: 'Jane' } })
    ).rejects.toMatchObject({ body: { code: DISPOSABLE_EMAIL_ERROR_CODE } })
  })

  it('admits a self-service email signup from a company under a public suffix', async () => {
    const auth = createAuth()
    const result = await auth.api.signUpEmail({
      body: { email: 'jane@company.msk.ru', password, name: 'Jane' },
    })
    expect(result.user.email).toBe('jane@company.msk.ru')
  })

  /** SCIM provisioning creates accounts through the admin plugin's server-side `createUser`. */
  it('admits a directory-provisioned account whatever its domain', async () => {
    const auth = createAuth()
    const result = await auth.api.createUser({
      body: { email: 'jane@mailinator.com', name: 'Jane' },
    })
    expect(result.user.email).toBe('jane@mailinator.com')
  })

  /**
   * Better Auth dispatches with an endpoint's declared path, so the SSO plugin's own callback
   * endpoints name the paths a just-in-time creation reports. No IdP is driven here.
   */
  const { callbackSSO, callbackSSOShared, callbackSSOSAML, acsEndpoint } =
    configuredSsoPlugin.endpoints
  it.each([callbackSSO.path, callbackSSOShared.path, callbackSSOSAML.path, acsEndpoint.path])(
    'admits any domain at the SSO plugin callback path %s',
    async (path) => {
      await expect(
        refuseDisposableAccountEmail('jane@mailinator.com', path)
      ).resolves.toBeUndefined()
    }
  )

  it.each([undefined, '/sign-up/email', '/callback/:id', '/oauth2/callback/:providerId'])(
    'refuses a disposable domain created at %s',
    async (path) => {
      await expect(refuseDisposableAccountEmail('jane@mailinator.com', path)).rejects.toMatchObject(
        { body: { code: DISPOSABLE_EMAIL_ERROR_CODE } }
      )
    }
  )
})
