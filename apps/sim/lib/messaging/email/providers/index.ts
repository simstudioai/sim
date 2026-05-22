import { createLogger } from '@sim/logger'
import { createAzureProvider } from '@/lib/messaging/email/providers/azure'
import { createResendProvider } from '@/lib/messaging/email/providers/resend'
import { createSesProvider } from '@/lib/messaging/email/providers/ses'
import { createSmtpProvider } from '@/lib/messaging/email/providers/smtp'
import type { MailProvider } from '@/lib/messaging/email/types'

const logger = createLogger('MailProviders')

/**
 * Provider factories in priority order. The first configured one becomes
 * the primary; the rest serve as automatic fallbacks. Operators select
 * a provider by setting its credentials — there is no `EMAIL_PROVIDER`
 * env var to maintain.
 */
const factories = [
  createResendProvider,
  createSesProvider,
  createSmtpProvider,
  createAzureProvider,
] as const

/**
 * Safely invoke a factory; a misconfigured provider must not prevent the
 * mailer module from loading or block other providers from registering.
 */
function safeCreate(factory: () => MailProvider | null): MailProvider | null {
  try {
    return factory()
  } catch (error) {
    logger.error('Mail provider factory threw at startup; skipping', error)
    return null
  }
}

export const activeProviders: readonly MailProvider[] = factories
  .map((factory) => safeCreate(factory))
  .filter((provider): provider is MailProvider => provider !== null)
