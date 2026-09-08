import { getErrorMessage } from '@sim/utils/errors'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage } from '@/lib/api/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  normalizeAtlassianDomain,
  validateAtlassianServiceAccount,
} from '@/lib/credentials/atlassian-service-account'
import {
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  type ClientCredentialAccountFieldId,
  getClientCredentialAccountDescriptor,
  isClientCredentialAccountProviderId,
  partitionClientCredentialFields,
  resolveClientCredentialAuthMethod,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  type ClientCredentialAccountFields,
  type ClientCredentialAccountSecretBlob,
  getClientCredentialAccountMinter,
} from '@/lib/credentials/client-credential-accounts/server'
import { slackCustomBotDisplayName } from '@/lib/credentials/display-name'
import {
  type ServiceAccountPrincipal,
  serviceAccountPrincipalMetadata,
} from '@/lib/credentials/principal'
import type { AtlassianProduct } from '@/lib/credentials/service-account-fields'
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
  atlassianProduct?: AtlassianProduct
  serviceAccountJson?: string
  clientId?: string
  clientSecret?: string
  certificateId?: string
  orgId?: string
  dataCenter?: string
  authMethod?: string
  privateKey?: string
  username?: string
}

export interface ServiceAccountSecretResult {
  /** Canonical provider id for the resolved secret. */
  providerId: string
  encryptedServiceAccountKey: string
  displayName: string
  auditMetadata: Record<string, string>
  /**
   * Provider principal behind the credential, or `null` when the provider
   * exposes none. Required (never optional) so a new provider cannot be added
   * without deciding what identity it captures.
   */
  principal: ServiceAccountPrincipal | null
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
  const product = fields.atlassianProduct ?? 'jira'
  const validation = await validateAtlassianServiceAccount(apiToken, normalizedDomain, product)
  const principal: ServiceAccountPrincipal = {
    kind: 'user',
    id: validation.accountId,
    ...(validation.emailAddress ? { label: validation.emailAddress } : {}),
  }
  // `atlassianAccountId` stays at the blob's top level: `getAtlassianServiceAccountSecret`
  // in `lib/oauth/credential-service.ts` reads it there on every existing credential.
  const blob = JSON.stringify({
    type: ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
    apiToken,
    domain: normalizedDomain,
    cloudId: validation.cloudId,
    atlassianProduct: product,
    atlassianAccountId: validation.accountId,
    metadata: serviceAccountPrincipalMetadata(principal),
  })
  const { encrypted } = await encryptSecret(blob)
  return {
    providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: {
      atlassianDomain: normalizedDomain,
      atlassianCloudId: validation.cloudId,
      ...serviceAccountPrincipalMetadata(principal),
    },
    principal,
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
  // `auth.test` returns the bot user only for bot tokens; a token without one
  // is workspace-scoped, so the team is the finest identity available.
  const principal: ServiceAccountPrincipal = botUserId
    ? { kind: 'user', id: botUserId }
    : { kind: 'tenant', id: teamId, ...(teamName ? { label: teamName } : {}) }
  const blob = JSON.stringify({
    type: SLACK_CUSTOM_BOT_SECRET_TYPE,
    signingSecret,
    botToken,
    teamId,
    botUserId,
    teamName,
    metadata: serviceAccountPrincipalMetadata(principal),
  })
  const { encrypted } = await encryptSecret(blob)
  return {
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: slackCustomBotDisplayName(teamName),
    auditMetadata: { slackTeamId: teamId, ...serviceAccountPrincipalMetadata(principal) },
    principal,
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
  const { client_email: clientEmail, project_id: projectId } = jsonParseResult.data
  // `client_email` is the principal a Google service account authenticates as
  // (its `unique_id` is not guaranteed to be present in a downloaded key).
  const principal: ServiceAccountPrincipal = { kind: 'user', id: clientEmail }
  // The blob stays the verbatim GCP key — every consumer parses it as one — so
  // the principal is mirrored into the audit metadata only.
  const { encrypted } = await encryptSecret(serviceAccountJson)
  return {
    providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: encrypted,
    displayName: clientEmail,
    auditMetadata: {
      googleClientEmail: clientEmail,
      googleProjectId: projectId,
      ...serviceAccountPrincipalMetadata(principal),
    },
    principal,
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
  const principalMetadata = serviceAccountPrincipalMetadata(validation.principal)
  const blob: TokenServiceAccountSecretBlob = {
    type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId,
    apiToken,
    ...(requiresDomain ? { domain: validation.normalizedDomain ?? domain } : {}),
    metadata: { ...validation.storedMetadata, ...principalMetadata },
  }
  const { encrypted } = await encryptSecret(JSON.stringify(blob))
  return {
    providerId,
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: { ...validation.auditMetadata, ...principalMetadata },
    principal: validation.principal,
  }
}

/**
 * Builds a client-credential service-account secret for any provider registered
 * in `CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS`: verifies the provider-specific
 * descriptor fields by minting a real access token (also capturing the derived
 * identity for the display name and audit log), then persists those fields in
 * the encrypted blob so execution-time resolution can re-mint.
 */
async function buildClientCredentialAccountSecret(
  providerId: string,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const descriptor = getClientCredentialAccountDescriptor(providerId)
  const minter = getClientCredentialAccountMinter(providerId)
  if (!descriptor || !minter) {
    throw new ServiceAccountSecretError(
      `No minter registered for service-account provider ${providerId}`
    )
  }
  // The resolved (never the raw) method drives both validation and what gets
  // persisted, so a credential's stored grant can't drift if the descriptor's
  // default ever changes.
  const resolvedAuthMethod = resolveClientCredentialAuthMethod(
    descriptor,
    fields.authMethod?.trim()
  )
  const { visible, required } = partitionClientCredentialFields(descriptor, resolvedAuthMethod)
  const usesField = (id: ClientCredentialAccountFieldId) => visible.some((field) => field.id === id)

  // A field the resolved grant does not use is dropped rather than stored, so
  // a request carrying both a consumer secret and a private key cannot leave
  // the unused one encrypted at rest on the credential.
  const submitted: ClientCredentialAccountFields = {
    clientId: fields.clientId?.trim() ?? '',
    certificateId: usesField('certificateId')
      ? fields.certificateId?.trim() || undefined
      : undefined,
    orgId: fields.orgId?.trim() ?? '',
    dataCenter: fields.dataCenter?.trim() || undefined,
    authMethod: resolvedAuthMethod,
    clientSecret: usesField('clientSecret') ? fields.clientSecret?.trim() || undefined : undefined,
    privateKey: usesField('privateKey') ? fields.privateKey?.trim() || undefined : undefined,
    username: usesField('username') ? fields.username?.trim() || undefined : undefined,
  }

  // Requirements are per-auth-method, not per-provider: Salesforce's JWT
  // branch needs a private key and username where its client-credentials
  // branch needs a consumer secret. The contract schema validates the
  // union-of-both shape, so the branch-specific check has to happen here.
  const missing = required.filter((field) => !submitted[field.id])
  if (missing.length > 0) {
    throw new ServiceAccountSecretError(
      `${missing.map((field) => field.label).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required for ${descriptor.serviceLabel} service account credentials`
    )
  }
  const mint = await minter(submitted)
  // `identity` is absent only on the `skipIdentity` execution-time path, which
  // never reaches this builder; treat it as "no principal captured".
  const principal = mint.identity?.principal ?? null
  const principalMetadata = serviceAccountPrincipalMetadata(principal)
  const blob: ClientCredentialAccountSecretBlob = {
    type: CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
    providerId,
    ...submitted,
    metadata: { ...mint.identity?.storedMetadata, ...principalMetadata },
  }
  const { encrypted } = await encryptSecret(JSON.stringify(blob))
  return {
    providerId,
    encryptedServiceAccountKey: encrypted,
    displayName: mint.identity?.displayName ?? `${descriptor.serviceLabel} ${submitted.orgId}`,
    auditMetadata: { ...mint.identity?.auditMetadata, ...principalMetadata },
    principal,
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
 * identically. Dispatches through the builder registry (bespoke providers),
 * the token-paste registry, or the client-credential minter registry; an
 * unknown/missing provider falls back to the
 * Google JSON-key builder for legacy creates. Throws
 * {@link ServiceAccountSecretError} on missing fields or a failed provider
 * verification (callers map it to a 400).
 */
export async function verifyAndBuildServiceAccountSecret(
  providerId: string,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const builder = Object.hasOwn(SERVICE_ACCOUNT_SECRET_BUILDERS, providerId)
    ? SERVICE_ACCOUNT_SECRET_BUILDERS[providerId]
    : undefined
  if (builder) return builder(fields)
  if (isTokenServiceAccountProviderId(providerId)) {
    return buildTokenServiceAccountSecret(providerId, fields)
  }
  if (isClientCredentialAccountProviderId(providerId)) {
    return buildClientCredentialAccountSecret(providerId, fields)
  }
  if (!providerId) {
    // Legacy Google creates omit providerId entirely (the original flow
    // predates multi-provider support).
    return buildGoogleServiceAccountSecret(fields)
  }
  throw new ServiceAccountSecretError(`Unsupported service-account provider: ${providerId}`)
}
