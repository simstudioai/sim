import { getErrorMessage } from '@sim/utils/errors'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage } from '@/lib/api/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  normalizeAtlassianDomain,
  validateAtlassianServiceAccount,
} from '@/lib/credentials/atlassian-service-account'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
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
 * Verifies a service-account secret against its provider, derives the display
 * name, and returns the encrypted blob ready to persist. Shared by credential
 * create (POST) and in-place reconnect (PUT) so both paths verify + encrypt
 * identically. Throws {@link ServiceAccountSecretError} on missing fields or a
 * failed provider verification (callers map it to a 400).
 */
export async function verifyAndBuildServiceAccountSecret(
  providerId: string,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
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

  if (providerId === SLACK_CUSTOM_BOT_PROVIDER_ID) {
    const { signingSecret, botToken } = fields
    if (!signingSecret || !botToken) {
      throw new ServiceAccountSecretError(
        'signingSecret and botToken are required for a custom Slack bot credential'
      )
    }
    // Verify the token and derive the workspace/team identity (never trusted
    // from the client) via auth.test.
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
    providerId: 'google-service-account',
    encryptedServiceAccountKey: encrypted,
    displayName: jsonParseResult.data.client_email,
    auditMetadata: {},
  }
}
