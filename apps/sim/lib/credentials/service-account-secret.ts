import { getErrorMessage } from '@sim/utils/errors'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage } from '@/lib/api/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import { mintAtlassianServiceAccountToken } from '@/lib/credentials/atlassian-client-credentials'
import {
  AtlassianValidationError,
  normalizeAtlassianDomain,
  validateAtlassianServiceAccount,
} from '@/lib/credentials/atlassian-service-account'
import {
  AwsCredentialError,
  verifyAndEncryptAwsCredential,
} from '@/lib/credentials/aws-service-account.server'
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
import { invalidateCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import {
  DatabricksCredentialError,
  verifyAndEncryptDatabricksCredential,
} from '@/lib/credentials/databricks-service-account.server'
import { slackCustomBotDisplayName } from '@/lib/credentials/display-name'
import {
  GoogleWorkloadIdentityError,
  isGoogleWorkloadIdentitySubmission,
  verifyAndEncryptGoogleWorkloadIdentityCredential,
} from '@/lib/credentials/google-workload-identity.server'
import {
  MicrosoftAppCredentialError,
  verifyAndEncryptMicrosoftAppCredential,
} from '@/lib/credentials/microsoft-app-service-account.server'
import { verifyAndEncryptOciApiKeyCredential } from '@/lib/credentials/oci-api-key-service-account.server'
import { verifyAndEncryptOracleDatabaseCredential } from '@/lib/credentials/oracledb-service-account.server'
import {
  type ServiceAccountPrincipal,
  serviceAccountPrincipalMetadata,
} from '@/lib/credentials/principal'
import type { AtlassianProduct } from '@/lib/credentials/service-account-fields'
import {
  SnowflakeCredentialError,
  verifyAndEncryptSnowflakeKeylessCredential,
} from '@/lib/credentials/snowflake-service-account.server'
import { getTokenClientCredentialMinter } from '@/lib/credentials/token-service-accounts/client-credentials'
import {
  CLIENT_CREDENTIALS_AUTH_METHOD,
  getTokenServiceAccountDescriptor,
  isTokenServiceAccountProviderId,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
  type TokenServiceAccountDescriptor,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  getTokenServiceAccountValidator,
  type TokenServiceAccountClientCredentialBlob,
  type TokenServiceAccountSecretBlob,
  type TokenServiceAccountValidator,
} from '@/lib/credentials/token-service-accounts/server'
import {
  KeylessCredentialRefusedError,
  type WorkloadIdentityCredentialOwner,
} from '@/lib/credentials/workload-identity/subject'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
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
  providerWorkspaceId?: string
  atlassianProduct?: AtlassianProduct
  serviceAccountJson?: string
  clientId?: string
  clientSecret?: string
  certificateId?: string
  orgId?: string
  dataCenter?: string
  scope?: string
  authMethod?: string
  privateKey?: string
  username?: string
  tenancyOcid?: string
  userOcid?: string
  fingerprint?: string
  privateKeyPassphrase?: string
  region?: string
  /**
   * Who owns the credential and who is saving it. Only providers whose secret
   * is bound to its owner read it (an AWS OIDC role subject is bound to the
   * workspace and the person who prepared it); every other builder ignores it.
   */
  owner?: WorkloadIdentityCredentialOwner
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
  /**
   * Keyless AWS, Databricks, Snowflake, Microsoft app, or Google: a subject this save binds that
   * the credential did not already hold, which must not belong to another credential of the owner.
   */
  newWorkloadIdentitySubject?: string
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
  if (fields.authMethod?.trim() === CLIENT_CREDENTIALS_AUTH_METHOD) {
    return buildAtlassianClientCredentialSecret(fields)
  }
  const apiToken = fields.apiToken?.trim()
  const { domain } = fields
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
 * Proves a client-credentials token with the provider's own identity check. Minted tokens are
 * shared across every credential for one application, so the token served can have been revoked
 * before its stated expiry (an app reinstall, a scope change). When the provider rejects it, that
 * token is expired and one freshly minted token is proven instead, so saving or reconnecting the
 * credential always recovers from a revoked token.
 */
async function proveMintedToken<T>(
  mint: () => Promise<{ accessToken: string }>,
  prove: (accessToken: string) => Promise<T>
): Promise<T> {
  const { accessToken } = await mint()
  try {
    return await prove(accessToken)
  } catch (error) {
    const rejected =
      (error instanceof TokenServiceAccountValidationError ||
        error instanceof AtlassianValidationError) &&
      error.code === 'invalid_credentials'
    if (!rejected) throw error
    await invalidateCoordinatedClientToken(accessToken)
    return prove((await mint()).accessToken)
  }
}

/**
 * Builds an Atlassian service-account secret for an OAuth 2.0 credential: mints a token with the
 * client ID and secret, proves it against the product's identity endpoint exactly as a scoped
 * API token is proven, and stores the client credentials so execution re-mints.
 */
async function buildAtlassianClientCredentialSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const clientId = fields.clientId?.trim()
  const clientSecret = fields.clientSecret?.trim()
  const domain = fields.domain?.trim()
  if (!clientId || !clientSecret || !domain) {
    throw new ServiceAccountSecretError(
      'clientId, clientSecret, and domain are required for Atlassian OAuth 2.0 credentials'
    )
  }
  const product = fields.atlassianProduct ?? 'jira'
  const normalizedDomain = normalizeAtlassianDomain(domain)
  const validation = await proveMintedToken(
    () => mintAtlassianServiceAccountToken(clientId, clientSecret),
    (accessToken) => validateAtlassianServiceAccount(accessToken, normalizedDomain, product)
  )
  const principal: ServiceAccountPrincipal = {
    kind: 'user',
    id: validation.accountId,
    ...(validation.emailAddress ? { label: validation.emailAddress } : {}),
  }
  const blob = JSON.stringify({
    type: ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
    authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
    clientId,
    clientSecret,
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
  // Rotation-enabled apps issue `xoxe.`-prefixed access tokens that expire in 12 hours and
  // `xoxe-` refresh tokens; refreshing needs the app's client ID and secret, which Sim
  // never holds, so such a token would pass auth.test today and fail every run tomorrow.
  if (/^\s*xoxe[.-]/.test(botToken)) {
    throw new ServiceAccountSecretError(
      'This Slack app has token rotation turned on, so its tokens expire within 12 hours and Sim cannot refresh them. Use the Bot User OAuth Token (xoxb-) of a Slack app with token rotation off.'
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
  if (isGoogleWorkloadIdentitySubmission(serviceAccountJson)) {
    return buildGoogleWorkloadIdentitySecret(serviceAccountJson, fields.owner)
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

/** A keyless Google Cloud credential: Workload Identity Federation, no stored key. */
async function buildGoogleWorkloadIdentitySecret(
  serviceAccountJson: string,
  owner: ServiceAccountSecretFields['owner']
): Promise<ServiceAccountSecretResult> {
  if (!owner) throw new ServiceAccountSecretError('Google Cloud credential owner is required')
  let result
  try {
    result = await verifyAndEncryptGoogleWorkloadIdentityCredential(serviceAccountJson, owner)
  } catch (error) {
    if (error instanceof KeylessCredentialRefusedError) throw error
    if (error instanceof GoogleWorkloadIdentityError) {
      throw new ServiceAccountSecretError(error.message)
    }
    throw new ServiceAccountSecretError(
      `Could not verify the Google Cloud keyless credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }
  const principal: ServiceAccountPrincipal = { kind: 'user', id: result.serviceAccountEmail }
  return {
    providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.serviceAccountEmail,
    auditMetadata: {
      googleClientEmail: result.serviceAccountEmail,
      googleWorkloadIdentityProvider: result.workloadIdentityProvider,
      ...serviceAccountPrincipalMetadata(principal),
    },
    principal,
    newWorkloadIdentitySubject: result.newSubject,
  }
}

async function buildAwsServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (!fields.serviceAccountJson)
    throw new ServiceAccountSecretError('AWS credential configuration is required')
  if (!fields.owner) throw new ServiceAccountSecretError('AWS credential owner is required')
  let result
  try {
    result = await verifyAndEncryptAwsCredential(fields.serviceAccountJson, fields.owner)
  } catch (error) {
    if (error instanceof KeylessCredentialRefusedError) throw error
    if (error instanceof AwsCredentialError) throw new ServiceAccountSecretError(error.message)
    throw new ServiceAccountSecretError(
      `Could not verify the AWS credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }
  const principal: ServiceAccountPrincipal = { kind: 'user', id: result.callerArn }
  return {
    providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.callerArn,
    auditMetadata: serviceAccountPrincipalMetadata(principal),
    principal,
    newWorkloadIdentitySubject: result.newSubject,
  }
}

async function buildDatabricksServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (!fields.serviceAccountJson)
    throw new ServiceAccountSecretError('Databricks credential configuration is required')
  if (!fields.owner) throw new ServiceAccountSecretError('Databricks credential owner is required')
  let result
  try {
    result = await verifyAndEncryptDatabricksCredential(fields.serviceAccountJson, fields.owner)
  } catch (error) {
    if (error instanceof KeylessCredentialRefusedError) throw error
    if (error instanceof DatabricksCredentialError) {
      throw new ServiceAccountSecretError(error.message)
    }
    throw new ServiceAccountSecretError(
      `Could not verify the Databricks credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }
  const principal: ServiceAccountPrincipal = { kind: 'user', id: result.identity }
  return {
    providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.identity,
    auditMetadata: serviceAccountPrincipalMetadata(principal),
    principal,
    newWorkloadIdentitySubject: result.newSubject,
  }
}

async function buildMicrosoftAppServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (!fields.serviceAccountJson)
    throw new ServiceAccountSecretError('Microsoft app credential configuration is required')
  if (!fields.owner)
    throw new ServiceAccountSecretError('Microsoft app credential owner is required')
  let result
  try {
    result = await verifyAndEncryptMicrosoftAppCredential(fields.serviceAccountJson, fields.owner)
  } catch (error) {
    if (error instanceof KeylessCredentialRefusedError) throw error
    if (error instanceof MicrosoftAppCredentialError) {
      throw new ServiceAccountSecretError(error.message)
    }
    throw new ServiceAccountSecretError(
      `Could not verify the Microsoft app credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }
  // The app's service principal is the identity every app-only token acts as.
  const principal: ServiceAccountPrincipal = {
    kind: 'user',
    id: result.servicePrincipalId,
    label: result.displayName,
  }
  return {
    providerId: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.displayName,
    auditMetadata: {
      microsoftTenantId: result.tenantId,
      ...serviceAccountPrincipalMetadata(principal),
    },
    principal,
    newWorkloadIdentitySubject: result.newSubject,
  }
}

async function buildOracleDatabaseServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (!fields.serviceAccountJson)
    throw new ServiceAccountSecretError('Oracle Database connection configuration is required')
  let result
  try {
    result = await verifyAndEncryptOracleDatabaseCredential(fields.serviceAccountJson)
  } catch {
    throw new ServiceAccountSecretError(
      'Could not verify the Oracle Database connection. Check the connection details and database permissions.'
    )
  }
  const principal: ServiceAccountPrincipal = { kind: 'user', id: result.username }
  return {
    providerId: ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.username,
    auditMetadata: serviceAccountPrincipalMetadata(principal),
    principal,
  }
}

async function buildOciApiKeyServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const { tenancyOcid, userOcid, fingerprint, privateKey, privateKeyPassphrase, region } = fields
  if (!tenancyOcid || !userOcid || !fingerprint || !privateKey || !region) {
    throw new ServiceAccountSecretError(
      'tenancyOcid, userOcid, fingerprint, privateKey, and region are required for OCI API-key credentials'
    )
  }
  const result = await verifyAndEncryptOciApiKeyCredential({
    tenancyOcid,
    userOcid,
    fingerprint,
    privateKey,
    ...(privateKeyPassphrase !== undefined ? { privateKeyPassphrase } : {}),
    region,
  })
  const principal: ServiceAccountPrincipal = { kind: 'user', id: result.userOcid }
  const metadata = serviceAccountPrincipalMetadata(principal)
  return {
    providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
    encryptedServiceAccountKey: result.encryptedServiceAccountKey,
    displayName: result.userOcid,
    auditMetadata: metadata,
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
  if (
    descriptor.clientCredentials &&
    fields.authMethod?.trim() === CLIENT_CREDENTIALS_AUTH_METHOD
  ) {
    return buildTokenClientCredentialSecret(descriptor, validator, fields)
  }
  const apiToken = descriptor.fields.find((field) => field.id === 'apiToken')?.preserveWhitespace
    ? fields.apiToken
    : fields.apiToken?.trim()
  const domain = fields.domain?.trim()
  const requiresDomain = descriptor.fields.some((field) => field.id === 'domain')
  const providerWorkspaceId = fields.providerWorkspaceId?.trim()
  const requiresWorkspace = descriptor.fields.some((field) => field.id === 'providerWorkspaceId')
  if (
    !apiToken ||
    !apiToken.trim() ||
    (requiresDomain && !domain) ||
    (requiresWorkspace && !providerWorkspaceId)
  ) {
    const required = descriptor.fields.map((field) => field.id).join(' and ')
    throw new ServiceAccountSecretError(
      `${required} ${descriptor.fields.length > 1 ? 'are' : 'is'} required for ${descriptor.serviceLabel} service account credentials`
    )
  }
  const validation = await validator({ apiToken, domain, providerWorkspaceId })
  const principalMetadata = serviceAccountPrincipalMetadata(validation.principal)
  const blob: TokenServiceAccountSecretBlob = {
    type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId,
    apiToken,
    ...(requiresDomain ? { domain: validation.normalizedDomain ?? domain } : {}),
    ...(requiresWorkspace
      ? { providerWorkspaceId: validation.normalizedWorkspaceId ?? providerWorkspaceId }
      : {}),
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
 * Builds a token provider's client-credentials secret: mints a token with the submitted client
 * ID and secret, proves it with the provider's own token check (the same request the pasted-token
 * mode verifies with), and stores the client credentials instead of a token so execution re-mints.
 */
async function buildTokenClientCredentialSecret(
  descriptor: TokenServiceAccountDescriptor,
  validator: TokenServiceAccountValidator,
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  const { providerId } = descriptor
  const mint = getTokenClientCredentialMinter(providerId)
  if (!mint) {
    throw new ServiceAccountSecretError(
      `No client-credentials grant registered for service-account provider ${providerId}`
    )
  }
  const clientId = fields.clientId?.trim()
  const clientSecret = fields.clientSecret?.trim()
  const domain = fields.domain?.trim()
  const requiresDomain = descriptor.fields.some((field) => field.id === 'domain')
  if (!clientId || !clientSecret || (requiresDomain && !domain)) {
    throw new ServiceAccountSecretError(
      `clientId, clientSecret${requiresDomain ? ', and domain are' : ' are'} required for ${descriptor.serviceLabel} client credentials`
    )
  }
  const validation = await proveMintedToken(
    () => mint({ clientId, clientSecret, ...(requiresDomain ? { domain } : {}) }),
    (accessToken) =>
      validator({
        apiToken: accessToken,
        ...(requiresDomain ? { domain } : {}),
        authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
      })
  )
  const principalMetadata = serviceAccountPrincipalMetadata(validation.principal)
  const blob: TokenServiceAccountClientCredentialBlob = {
    type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId,
    authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
    clientId,
    clientSecret,
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
 * Builds a Snowflake secret. A JSON configuration is the keyless mode (no
 * stored secret); otherwise the pasted programmatic access token goes through
 * the token-paste builder exactly as before. Snowflake's own refusals keep the
 * shared validation codes so callers report them like any token check.
 */
async function buildSnowflakeServiceAccountSecret(
  fields: ServiceAccountSecretFields
): Promise<ServiceAccountSecretResult> {
  if (!fields.serviceAccountJson) {
    return buildTokenServiceAccountSecret(SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID, fields)
  }
  if (fields.apiToken) {
    throw new ServiceAccountSecretError(
      'Send either a programmatic access token or a keyless configuration, not both'
    )
  }
  if (!fields.owner) throw new ServiceAccountSecretError('Snowflake credential owner is required')
  try {
    const result = await verifyAndEncryptSnowflakeKeylessCredential(
      fields.serviceAccountJson,
      fields.owner
    )
    return { providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID, ...result }
  } catch (error) {
    if (error instanceof SnowflakeCredentialError) {
      throw new ServiceAccountSecretError(error.message)
    }
    throw error
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
    scope: usesField('scope') ? fields.scope?.trim() || undefined : undefined,
    authMethod: resolvedAuthMethod,
    clientSecret: usesField('clientSecret')
      ? (visible.find((field) => field.id === 'clientSecret')?.preserveWhitespace
          ? fields.clientSecret
          : fields.clientSecret?.trim()) || undefined
      : undefined,
    privateKey: usesField('privateKey') ? fields.privateKey?.trim() || undefined : undefined,
    username: usesField('username') ? fields.username?.trim() || undefined : undefined,
    apiToken: usesField('apiToken') ? fields.apiToken?.trim() || undefined : undefined,
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
  [OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID]: buildOciApiKeyServiceAccountSecret,
  [ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID]: buildOracleDatabaseServiceAccountSecret,
  [AWS_SERVICE_ACCOUNT_PROVIDER_ID]: buildAwsServiceAccountSecret,
  [DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID]: buildDatabricksServiceAccountSecret,
  [MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID]: buildMicrosoftAppServiceAccountSecret,
  [SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID]: buildSnowflakeServiceAccountSecret,
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
  if (providerId === GITHUB_INSTALLATION_PROVIDER_ID) {
    throw new ServiceAccountSecretError(
      'Connect a GitHub App installation through your organization’s Search integrations'
    )
  }
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
