import { getErrorMessage } from '@sim/utils/errors'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage } from '@/lib/api/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  normalizeAtlassianDomain,
  validateAtlassianServiceAccount,
} from '@/lib/credentials/atlassian-service-account'
import {
  getTokenServiceAccountDescriptor,
  isTokenServiceAccountProviderId,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  getTokenServiceAccountValidator,
  type TokenServiceAccountSecretBlob,
} from '@/lib/credentials/token-service-accounts/server'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_SECRET_TYPE,
} from '@/lib/oauth/types'
import { fetchSlackTeamId } from '@/lib/webhooks/providers/slack'

/** Provider-specific secret inputs a service-account credential can carry. */
export interface ServiceAccountSecretFields {
  signingSecret?: string
  botToken?: string
  apiToken?: string
  domain?: string
  serviceAccountJson?: string
}

export interface ServiceAccountSecretResult {
  /** Canonical provider id for the resolved secret. */
  providerId: string
  encryptedServiceAccountKey: string
  displayName: string
  auditMetadata: Record<string, string>
  /** Slack custom bot: the derived bot user id (for reaction self-drop). */
  botUserId?: string
}

/** Thrown when a service-account secret is missing or fails provider verification. */
export class ServiceAccountSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceAccountSecretError'
  }
}

/**
 * Builds an Atlassian service-account secret (scoped API token + site domain).
 */
async function buildAtlassianServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const { apiToken, domain } = fields
  if (!apiToken || !domain) {
    throw new ServiceAccountSecretError(
      'apiToken and domain are required for Atlassian service account credentials'
    )
  }
  const normalizedDomain = normalizeAtlassianDomain(domain)
  const validation = await validateAtlassianServiceAccount(apiToken, normalizedDomain)
  const blob = JSON.stringify({
    type: ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
    apiToken,
    domain: normalizedDomain,
    cloudId: validation.cloudId,
    atlassianAccountId: validation.accountId,
  })
  const { encrypted } = await encryptSecret(blob)
  return {
    providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: {
      atlassianDomain: normalizedDomain,
      atlassianCloudId: validation.cloudId,
    },
  }
}

/**
 * Builds a custom Slack bot secret. The workspace/team identity is derived via
 * `auth.test` and never trusted from the client.
 */
async function buildSlackCustomBotSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const { signingSecret, botToken } = fields
  if (!signingSecret || !botToken) {
    throw new ServiceAccountSecretError(
      'signingSecret and botToken are required for a custom Slack bot credential'
    )
  }
  let teamId: string
  let botUserId: string | undefined
  let teamName: string | undefined
  try {
    const auth = await fetchSlackTeamId(botToken)
    teamId = auth.teamId
    botUserId = auth.userId
    teamName = auth.teamName
  } catch (error) {
    throw new ServiceAccountSecretError(
      `Could not verify the Slack bot token: ${getErrorMessage(error)}`
    )
  }
  const blob = JSON.stringify({
    type: SLACK_CUSTOM_BOT_SECRET_TYPE,
    signingSecret,
    botToken,
    teamId,
    botUserId,
    teamName,
  })
  const { encrypted } = await encryptSecret(blob)
  return {
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: teamName || 'Slack bot',
    auditMetadata: { slackTeamId: teamId },
    botUserId,
  }
}

/**
 * Builds a Google service-account secret from a pasted JSON key. Also the
 * fallback for creates without a `providerId` — the original service-account
 * flow predates multi-provider support.
 */
async function buildGoogleServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const { serviceAccountJson } = fields
  if (!serviceAccountJson) {
    throw new ServiceAccountSecretError(
      'serviceAccountJson is required for service account credentials'
    )
  }
  const jsonParseResult = serviceAccountJsonSchema.safeParse(serviceAccountJson)
  if (!jsonParseResult.success) {
    throw new ServiceAccountSecretError(
      getValidationErrorMessage(jsonParseResult.error, 'Invalid service account JSON')
    )
  }
  const { encrypted } = await encryptSecret(serviceAccountJson)
  return {
    providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: jsonParseResult.data.client_email,
    auditMetadata: {},
  }
}

/**
 * Builds a token-paste service-account secret for any provider registered in
 * `TOKEN_SERVICE_ACCOUNT_DESCRIPTORS`: verifies the pasted token via the
 * provider's registered validator and persists it (plus any normalized domain
 * and non-secret metadata) in the encrypted blob.
 */
async function buildTokenServiceAccountSecret(
  providerId: string,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const descriptor = getTokenServiceAccountDescriptor(providerId)
  const validator = getTokenServiceAccountValidator(providerId)
  if (!descriptor || !validator) {
    throw new ServiceAccountSecretError(
      `No validator registered for service-account provider ${providerId}`
    )
  }
  const apiToken = fields.apiToken?.trim()
  const domain = fields.domain?.trim()
  const requiresDomain = descriptor.fields.some((field) => field.id === 'domain')
  if (!apiToken || (requiresDomain && !domain)) {
    const required = descriptor.fields.map((field) => field.id).join(' and ')
    throw new ServiceAccountSecretError(
      `${required} ${descriptor.fields.length > 1 ? 'are' : 'is'} required for ${descriptor.serviceLabel} service account credentials`
    )
  }
  const validation = await validator({ apiToken, domain })
  const blob: TokenServiceAccountSecretBlob = {
    type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId,
    apiToken,
    ...(requiresDomain ? { domain: validation.normalizedDomain ?? domain } : {}),
    ...(validation.storedMetadata ? { metadata: validation.storedMetadata } : {}),
  }
  const { encrypted } = await encryptSecret(JSON.stringify(blob))
  return {
    providerId,
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: validation.auditMetadata,
  }
}

type ServiceAccountSecretBuilder = (
  fields: ServiceAccountSecretFields
) => Promise<ServiceAccountSecretResult>

/**
 * Builder registry for the bespoke service-account providers. Token-paste
 * providers resolve through `TOKEN_SERVICE_ACCOUNT_DESCRIPTORS` instead of
 * individual entries here.
 */
const SERVICE_ACCOUNT_SECRET_BUILDERS: Record<string, ServiceAccountSecretBuilder> = {
  [ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID]: buildAtlassianServiceAccountSecret,
  [SLACK_CUSTOM_BOT_PROVIDER_ID]: buildSlackCustomBotSecret,
  [GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID]: buildGoogleServiceAccountSecret,
}

/**
 * Verifies a service-account secret against its provider, derives the display
 * name, and returns the encrypted blob ready to persist. Shared by credential
 * create (POST) and in-place reconnect (PUT) so both paths verify + encrypt
 * identically. Dispatches through the builder registry (bespoke providers)
 * or the token-paste registry; an unknown/missing provider falls back to the
 * Google JSON-key builder for legacy creates. Throws
 * {@link ServiceAccountSecretError} on missing fields or a failed provider
 * verification (callers map it to a 400).
 */
export async function verifyAndBuildServiceAccountSecret(
  providerId: string,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const builder = SERVICE_ACCOUNT_SECRET_BUILDERS[providerId]
  if (builder) return builder(fields)
  if (isTokenServiceAccountProviderId(providerId)) {
    return buildTokenServiceAccountSecret(providerId, fields)
  }
  if (!providerId) {
    // Legacy Google creates omit providerId entirely (the original flow
    // predates multi-provider support).
    return buildGoogleServiceAccountSecret(fields)
  }
  throw new ServiceAccountSecretError(`Unsupported service-account provider: ${providerId}`)
}
