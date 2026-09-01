import { isEmailVerificationEnabled } from '@/lib/core/config/env-flags'
import { hasEmailService } from '@/lib/messaging/email/mailer'

/**
 * Whether email verification is actually enforceable on this deployment.
 *
 * `EMAIL_VERIFICATION_ENABLED` alone only says the operator wants verification;
 * without a configured mail provider no code can ever be delivered, so
 * enforcing it locks every new account out behind a screen it cannot satisfy.
 * This is the single server-derived value Better Auth enforcement, signup
 * routing, and the verify page all read, so they cannot disagree.
 */
export function isEmailVerificationEffectivelyEnabled(): boolean {
  return isEmailVerificationEnabled && hasEmailService()
}
