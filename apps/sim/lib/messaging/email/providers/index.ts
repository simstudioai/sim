import { createLogger } from '@sim/logger'
import { EMAIL_CAPABILITY, type FallbackFactories } from '@/lib/core/config/env-capabilities'
import { wireServerFallback } from '@/lib/core/config/env-capabilities.server'
import { createAzureProvider } from '@/lib/messaging/email/providers/azure'
import { createGmailProvider } from '@/lib/messaging/email/providers/gmail'
import { createResendProvider } from '@/lib/messaging/email/providers/resend'
import { createSesProvider } from '@/lib/messaging/email/providers/ses'
import { createSmtpProvider } from '@/lib/messaging/email/providers/smtp'
import type { MailProvider } from '@/lib/messaging/email/types'

const logger = createLogger('MailProviders')

const factories = {
  resend: createResendProvider,
  ses: createSesProvider,
  smtp: createSmtpProvider,
  azure: createAzureProvider,
  gmail: createGmailProvider,
} satisfies FallbackFactories<typeof EMAIL_CAPABILITY, MailProvider>

export const emailFallback = wireServerFallback<typeof EMAIL_CAPABILITY, MailProvider>({
  definition: EMAIL_CAPABILITY,
  factories,
  onFailure(providerId, error) {
    logger.warn(`${providerId} failed, trying next provider`, error)
  },
})

export const activeProviders: readonly MailProvider[] = emailFallback.providers
