import { createLogger } from '@sim/logger'
import { APIError } from 'better-auth/api'
import { DISPOSABLE_EMAIL_ERROR_CODE, DISPOSABLE_EMAIL_MESSAGE } from '@/lib/auth/constants'
import { isSsoCallbackPath } from '@/lib/auth/sso/callback-provider'
import { emailDomain, isDisposableEmail } from '@/lib/messaging/email/disposable'

const logger = createLogger('DisposableEmailGate')

/**
 * The admin plugin's endpoint, which SCIM provisioning calls server-side. Over HTTP it requires a
 * platform admin's session, so either way an account created here was not self-service.
 */
const ADMIN_CREATE_USER_PATH = '/admin/create-user'

/**
 * Whether the account is being created on behalf of an organization: SCIM provisioning, or
 * just-in-time creation at an SSO callback (Sim admits SSO only through a provider whose domain
 * the organization verified). The organization vouches for the identity, so a throwaway inbox is
 * not the risk, while a false positive breaks provisioning (a refused SCIM create is retried by
 * the IdP indefinitely).
 */
function isOrganizationProvisioned(path: string | undefined): boolean {
  return path !== undefined && (path === ADMIN_CREATE_USER_PATH || isSsoCallbackPath(path))
}

/**
 * Refuses self-service account creation from a disposable email domain, throwing the
 * `DISPOSABLE_EMAIL` error the signup form and OAuth error page recognize.
 *
 * @param path - the Better Auth endpoint the creation runs under (`context?.path` in
 * `databaseHooks.user.create.before`), which tells organization provisioning apart from signup.
 */
export async function refuseDisposableAccountEmail(
  email: string,
  path: string | undefined
): Promise<void> {
  if (isOrganizationProvisioned(path)) return
  if (!(await isDisposableEmail(email))) return

  logger.warn('Refusing account creation for a disposable email domain', {
    domain: emailDomain(email),
    path,
  })
  throw new APIError('FORBIDDEN', {
    code: DISPOSABLE_EMAIL_ERROR_CODE,
    message: DISPOSABLE_EMAIL_MESSAGE,
  })
}
