import { createLogger } from '@sim/logger'
import { createAzureProvider } from '@/lib/messaging/email/providers/azure'
import { createResendProvider } from '@/lib/messaging/email/providers/resend'
import { createSesProvider } from '@/lib/messaging/email/providers/ses'
import { createSmtpProvider } from '@/lib/messaging/email/providers/smtp'
import type { MailProvider } from '@/lib/messaging/email/types'

const logger = createLogger('MailProviders')

const factories = [
  createResendProvider,
  createSesProvider,
  createSmtpProvider,
  createAzureProvider,
] as const

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
