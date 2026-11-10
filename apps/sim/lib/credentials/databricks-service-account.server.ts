import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { validateDatabricksWorkspaceHost } from '@/lib/core/security/input-validation'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import {
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
import {
  mintWorkloadIdentityToken,
  type WorkloadIdentityOwner,
} from '@/lib/credentials/workload-identity/issuer'
import {
  bindWorkloadIdentitySubject,
  type WorkloadIdentityCredentialOwner,
  WorkloadIdentitySubjectError,
} from '@/lib/credentials/workload-identity/subject'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/**
 * Saved Databricks connections for the Databricks block.
 *
 * - `personal_access_token`: a PAT used as-is, like an inline token.
 * - `service_principal`: OAuth machine-to-machine — the service principal's
 *   client ID and secret mint a workspace token per run.
 * - `oidc_federation`: no stored secret — Sim signs a short-lived OIDC token
 *   for this credential's subject and exchanges it (RFC 8693) for a token of
 *   the service principal whose federation policy trusts it.
 *
 * Every mode resolves server-side to a bearer token plus the workspace host
 * (`accessToken`, `domain`), which fill the tools' `apiKey` and `host`.
 */

const DATABRICKS_CREDENTIAL_SECRET_TYPE = 'databricks_credential_v1' as const
const DATABRICKS_WORKLOAD_IDENTITY_AUDIENCE = WORKLOAD_IDENTITY_AUDIENCES.databricks

const REQUEST_TIMEOUT_MS = 15_000
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/

/** Workspace origin with Databricks' own host allowlist as the SSRF guard. */
function workspaceOrigin(host: string): string {
  const result = validateDatabricksWorkspaceHost(host.trim().replace(/^http:\/\//i, ''), 'host')
  if (!result.isValid || !result.sanitized) {
    throw new DatabricksCredentialError(result.error || 'Invalid Databricks workspace host')
  }
  return result.sanitized
}

const hostSchema = z
  .string()
  .trim()
  .min(1, 'Databricks workspace host is required')
  .max(255)
  .transform((value, context) => {
    try {
      return new URL(workspaceOrigin(value)).host
    } catch (error) {
      context.addIssue({ code: 'custom', message: getErrorMessage(error, 'Invalid host') })
      return z.NEVER
    }
  })

const clientIdSchema = z.string().trim().regex(CLIENT_ID_PATTERN, 'Invalid client ID')

const oidcShape = {
  authType: z.literal('oidc_federation'),
  host: hostSchema,
  clientId: clientIdSchema,
  subject: z.string().min(1).max(512),
}

const patSchema = z
  .object({
    authType: z.literal('personal_access_token'),
    host: hostSchema,
    token: z.string().trim().min(1, 'Personal access token is required').max(4096),
  })
  .strict()

const servicePrincipalSchema = z
  .object({
    authType: z.literal('service_principal'),
    host: hostSchema,
    clientId: clientIdSchema,
    clientSecret: z.string().min(1, 'OAuth secret is required').max(4096),
  })
  .strict()

const storedConfigSchema = z.discriminatedUnion('authType', [
  patSchema,
  servicePrincipalSchema,
  z.object(oidcShape).strict(),
])

type DatabricksCredentialConfig = z.infer<typeof storedConfigSchema>

const submittedConfigSchema = z.discriminatedUnion('authType', [
  patSchema,
  servicePrincipalSchema,
  z
    .object({
      ...oidcShape,
      subject: oidcShape.subject.optional(),
      subjectProof: z.string().min(1).max(512).optional(),
    })
    .strict(),
])

const storedSecretSchema = z
  .object({ type: z.literal(DATABRICKS_CREDENTIAL_SECRET_TYPE), config: storedConfigSchema })
  .strict()

export class DatabricksCredentialError extends Error {
  /** @param status Databricks' HTTP status, when Databricks itself refused the request. */
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'DatabricksCredentialError'
  }
}

async function requestWorkspaceToken(
  host: string,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {}
): Promise<string> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(`${workspaceOrigin(host)}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body,
    // A secret or subject token must never follow a redirect off the workspace host.
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown
    error_description?: unknown
    error?: unknown
  }
  if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
    const reason =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
    throw new DatabricksCredentialError(
      `Databricks rejected the token request: ${reason}`,
      response.status
    )
  }
  return payload.access_token
}

/** A bearer token for the configured workspace. */
async function resolveDatabricksAccessToken(
  config: DatabricksCredentialConfig,
  owner: WorkloadIdentityOwner,
  signal?: AbortSignal
): Promise<string> {
  if (config.authType === 'personal_access_token') return config.token
  if (config.authType === 'service_principal') {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    return requestWorkspaceToken(
      config.host,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
      signal,
      { Authorization: `Basic ${basic}` }
    )
  }
  const subjectToken = await mintWorkloadIdentityToken({
    subject: config.subject,
    audience: DATABRICKS_WORKLOAD_IDENTITY_AUDIENCE,
    owner,
  })
  return requestWorkspaceToken(
    config.host,
    new URLSearchParams({
      client_id: config.clientId,
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      scope: 'all-apis',
    }),
    signal
  )
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success && parsed.data.config.authType === 'oidc_federation'
    ? parsed.data.config.subject
    : undefined
}

function bindSubject(
  subject: string | undefined,
  subjectProof: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  try {
    return bindWorkloadIdentitySubject({
      provider: 'databricks',
      owner,
      storedSubject: readStoredSubject(owner.storedSecret),
      subject,
      subjectProof,
    })
  } catch (error) {
    if (error instanceof WorkloadIdentitySubjectError) {
      throw new DatabricksCredentialError(error.message)
    }
    throw error
  }
}

/**
 * Validates the submitted configuration, proves it by calling the workspace's
 * SCIM `Me` endpoint with the resolved token, and returns the encrypted blob
 * plus the identity Databricks reports.
 */
export async function verifyAndEncryptDatabricksCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<{ encryptedServiceAccountKey: string; identity: string }> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Databricks credential'
  )
  if (!parsed.success) throw new DatabricksCredentialError(parsed.message)
  const submitted = parsed.data
  let config: DatabricksCredentialConfig
  if (submitted.authType === 'oidc_federation') {
    const { subject, subjectProof, ...rest } = submitted
    config = { ...rest, subject: bindSubject(subject, subjectProof, owner) }
  } else {
    config = submitted
  }

  let identity: string
  try {
    const token = await resolveDatabricksAccessToken(config, owner)
    const response = await fetch(`${workspaceOrigin(config.host)}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`workspace returned HTTP ${response.status}`)
    const me = (await response.json().catch(() => ({}))) as {
      userName?: unknown
      displayName?: unknown
    }
    identity =
      (typeof me.userName === 'string' && me.userName) ||
      (typeof me.displayName === 'string' && me.displayName) ||
      config.host
  } catch (error) {
    throw new DatabricksCredentialError(
      `Could not verify the Databricks credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }

  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: DATABRICKS_CREDENTIAL_SECRET_TYPE, config })
  )
  return { encryptedServiceAccountKey: encrypted, identity }
}

/**
 * Resolves an executor-authorized Databricks credential (the executor already
 * checked the caller may use it) to a token and its workspace host.
 */
export async function resolveDatabricksCredentialToken(
  credentialId: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; domain: string }> {
  const [row] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      providerId: credential.providerId,
      revokedAt: credential.revokedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  ) {
    throw new DatabricksCredentialError('Databricks credential is unavailable')
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  const { config } = storedSecretSchema.parse(JSON.parse(decrypted))
  const owner: WorkloadIdentityOwner = row.workspaceId
    ? { workspaceId: row.workspaceId }
    : { organizationId: row.organizationId ?? undefined }
  try {
    return {
      accessToken: await resolveDatabricksAccessToken(config, owner, signal),
      domain: config.host,
    }
  } catch (error) {
    if (!(error instanceof DatabricksCredentialError)) throw error
    // Report in the shared service-account codes: an outage is not a bad credential.
    const unavailable =
      error.status !== undefined && (error.status >= 500 || isTransientProviderStatus(error.status))
    throw new TokenServiceAccountValidationError(
      unavailable ? 'provider_unavailable' : 'invalid_credentials',
      error.status ?? 400,
      { step: 'token', reason: error.message }
    )
  }
}
