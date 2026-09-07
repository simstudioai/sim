import { createHash } from 'node:crypto'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import type { QuickBooksEnvironment } from '@/tools/quickbooks/client'

export interface QuickBooksOAuthClientConfig {
  clientId: string
  clientSecret: string
  environment: QuickBooksEnvironment
  webhookVerifierToken: string
}

const MAX_CLIENT_ID_LENGTH = 255
const MAX_CLIENT_SECRET_LENGTH = 512
const MAX_WEBHOOK_VERIFIER_TOKEN_LENGTH = 512

export const QUICKBOOKS_WEBHOOK_APP_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

export class QuickBooksOAuthClientConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuickBooksOAuthClientConfigurationError'
  }
}

export function normalizeQuickBooksOAuthClientConfig(
  value: QuickBooksOAuthClientConfig
): QuickBooksOAuthClientConfig {
  const clientId = value.clientId.trim()
  const clientSecret = value.clientSecret.trim()
  if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks client ID must be between 1 and 255 characters'
    )
  }
  if (!clientSecret || clientSecret.length > MAX_CLIENT_SECRET_LENGTH) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks client secret must be between 1 and 512 characters'
    )
  }
  if (value.environment !== 'sandbox' && value.environment !== 'production') {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks environment must be either sandbox or production'
    )
  }
  const webhookVerifierToken = value.webhookVerifierToken.trim()
  if (!webhookVerifierToken || webhookVerifierToken.length > MAX_WEBHOOK_VERIFIER_TOKEN_LENGTH) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks webhook verifier token must be between 1 and 512 characters'
    )
  }
  return {
    clientId,
    clientSecret,
    environment: value.environment,
    webhookVerifierToken,
  }
}

/** Stable, non-secret route key for one Intuit app in one environment. */
export function deriveQuickBooksWebhookAppKey(
  value: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'environment'>
): string {
  const clientId = value.clientId.trim()
  if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks client ID must be between 1 and 255 characters'
    )
  }
  if (value.environment !== 'sandbox' && value.environment !== 'production') {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks environment must be either sandbox or production'
    )
  }
  return createHash('sha256')
    .update(`${value.environment}\0${clientId}`, 'utf8')
    .digest('base64url')
}

export async function encryptQuickBooksOAuthClientConfig(
  value: QuickBooksOAuthClientConfig
): Promise<string> {
  const normalized = normalizeQuickBooksOAuthClientConfig(value)
  const { encrypted } = await encryptSecret(JSON.stringify(normalized))
  return encrypted
}

export async function decryptQuickBooksOAuthClientConfig(
  encryptedValue: string
): Promise<QuickBooksOAuthClientConfig> {
  const { decrypted } = await decryptSecret(encryptedValue)
  let value: unknown
  try {
    value = JSON.parse(decrypted)
  } catch {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks OAuth client configuration is invalid'
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks OAuth client configuration is invalid'
    )
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.clientId !== 'string' ||
    typeof record.clientSecret !== 'string' ||
    (record.environment !== 'sandbox' && record.environment !== 'production') ||
    typeof record.webhookVerifierToken !== 'string'
  ) {
    throw new QuickBooksOAuthClientConfigurationError(
      'QuickBooks OAuth client configuration is invalid'
    )
  }
  return normalizeQuickBooksOAuthClientConfig({
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    environment: record.environment,
    webhookVerifierToken: record.webhookVerifierToken,
  })
}
