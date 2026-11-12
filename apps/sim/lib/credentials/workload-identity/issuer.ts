import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { calculateJwkThumbprint, type JWK, SignJWT } from 'jose'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  assertWorkloadIdentitySubjectOwner,
  WorkloadIdentityNotConfiguredError,
} from '@/lib/credentials/workload-identity/subject'

/**
 * Sim's workload-identity issuer: a minimal OpenID Connect token issuer that
 * lets a customer's cloud trust Sim directly, so a credential can assume an
 * AWS role (or federate into another cloud) without any long-lived key stored
 * in Sim.
 *
 * It is deliberately separate from the Better Auth OAuth server, which is an
 * opaque-token API-authorization surface with JWT/JWKS disabled. This issuer
 * only signs short-lived tokens for Sim's own server-side use while a saved
 * credential resolves; tokens never reach a block output, the model, or a
 * browser.
 */

const logger = createLogger('WorkloadIdentityIssuer')

export const WORKLOAD_IDENTITY_PATH = '/oidc/workload'
export const WORKLOAD_IDENTITY_ALGORITHM = 'RS256'
export const WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS = 300
/** The longest lifetime a relying party may ask for; Databricks caps its own token at an hour. */
export const MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS = 3600

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const

interface SigningMaterial {
  privateKey: KeyObject
  kid: string
  jwks: { keys: JWK[] }
}

/** Env values often arrive with escaped newlines; PEM parsing needs real ones. */
function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
}

async function toPublicJwk(key: KeyObject): Promise<JWK> {
  const publicKey = key.type === 'public' ? key : createPublicKey(key)
  const exported = publicKey.export({ format: 'jwk' }) as JWK
  for (const field of PRIVATE_JWK_FIELDS) delete exported[field]
  if (exported.kty !== 'RSA') {
    throw new Error('Workload identity keys must be RSA keys')
  }
  const kid = await calculateJwkThumbprint(exported, 'sha256')
  return { ...exported, kid, alg: WORKLOAD_IDENTITY_ALGORITHM, use: 'sig' }
}

/**
 * The retiring key's public JWK, or null when it is unset or unusable. A bad
 * retiring key only drops that key from the JWKS; the current key keeps signing.
 */
async function loadPreviousPublicJwk(): Promise<JWK | null> {
  const previousKey = env.WORKLOAD_IDENTITY_PREVIOUS_KEY
  if (!previousKey) return null
  try {
    return await toPublicJwk(createPublicKey(normalizePem(previousKey)))
  } catch (error) {
    logger.error('Workload identity previous key is set but unusable', { error })
    return null
  }
}

/**
 * AWS and Databricks fetch discovery and keys from the issuer over https on the
 * default port, and discovery appends paths to it, so any other issuer (or one
 * with a query or fragment) can never be trusted; keyless stays off
 * rather than advertising an issuer no relying party accepts.
 *
 * Sim serves discovery and keys under {@link WORKLOAD_IDENTITY_PATH}. A pinned
 * issuer whose path ends there reaches them directly or through a
 * prefix-stripping proxy, like the default issuer on a path-prefixed app URL.
 * Any other path works only if a proxy routes it to that path, which Sim can't
 * see, so it is warned about rather than refused: trust policies already name
 * the pinned URL, and saving a keyless credential proves the route end to end.
 */
function assertPublicIssuer(issuer: string): void {
  const url = new URL(issuer)
  if (url.protocol !== 'https:' || url.port || url.search || url.hash) {
    throw new Error(
      'Workload identity issuer must be an https URL without a port, query, or fragment'
    )
  }
  if (env.WORKLOAD_IDENTITY_ISSUER?.trim()) {
    if (!url.pathname.endsWith(WORKLOAD_IDENTITY_PATH)) {
      logger.warn(
        `WORKLOAD_IDENTITY_ISSUER does not end in ${WORKLOAD_IDENTITY_PATH}, where Sim serves discovery and keys; clouds can verify its tokens only if a proxy routes the issuer there`,
        { issuer }
      )
    }
    return
  }
  logger.warn(
    'Workload identity issuer follows the app URL; set WORKLOAD_IDENTITY_ISSUER so customer trust policies survive a URL change',
    { issuer }
  )
}

let signingMaterial: Promise<SigningMaterial> | undefined

/**
 * Loads the signing key once per process. The key is immutable config (it only
 * changes on redeploy), so this is a memoized derivation rather than a cache,
 * and a malformed key is parsed and reported once rather than per request.
 */
function loadSigningMaterial(): Promise<SigningMaterial> {
  const signingKey = env.WORKLOAD_IDENTITY_SIGNING_KEY
  if (!signingKey) return Promise.reject(new WorkloadIdentityNotConfiguredError())
  if (!signingMaterial) {
    signingMaterial = (async () => {
      assertPublicIssuer(getWorkloadIdentityIssuer())
      const privateKey = createPrivateKey(normalizePem(signingKey))
      const current = await toPublicJwk(privateKey)
      const keys = [current]
      const previous = await loadPreviousPublicJwk()
      if (previous && previous.kid !== current.kid) keys.push(previous)
      return { privateKey, kid: current.kid as string, jwks: { keys } }
    })()
    signingMaterial.catch((error: unknown) => {
      logger.error(
        'Workload identity is configured but unusable (check the signing key and issuer)',
        {
          error,
        }
      )
    })
  }
  return signingMaterial
}

/**
 * Whether this deployment can mint workload-identity tokens: a signing key is
 * set and parses, so a malformed key never advertises an issuer that can't sign.
 */
export async function isWorkloadIdentityConfigured(): Promise<boolean> {
  if (!env.WORKLOAD_IDENTITY_SIGNING_KEY) return false
  return loadSigningMaterial().then(
    () => true,
    () => false
  )
}

/** The issuer URL customers register as an OIDC identity provider. Stable for the deployment's life. */
export function getWorkloadIdentityIssuer(): string {
  const configured = env.WORKLOAD_IDENTITY_ISSUER?.trim()
  return (configured || `${getBaseUrl()}${WORKLOAD_IDENTITY_PATH}`).replace(/\/+$/, '')
}

/** OpenID Connect discovery document for the issuer. */
export function getWorkloadIdentityDiscoveryDocument() {
  const issuer = getWorkloadIdentityIssuer()
  return {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [WORKLOAD_IDENTITY_ALGORITHM],
    scopes_supported: ['openid'],
    claims_supported: [
      'iss',
      'sub',
      'aud',
      'exp',
      'iat',
      'nbf',
      'jti',
      'sim_workspace_id',
      'sim_organization_id',
    ],
  }
}

/** Public signing keys, including a retiring key during rotation. */
export async function getWorkloadIdentityJwks(): Promise<{ keys: JWK[] }> {
  return (await loadSigningMaterial()).jwks
}

export interface WorkloadIdentityOwner {
  workspaceId?: string
  organizationId?: string
}

export interface MintWorkloadIdentityTokenInput {
  /** Fully-qualified subject; see `buildWorkloadIdentitySubject`. */
  subject: string
  /** Relying party, e.g. `sts.amazonaws.com`. */
  audience: string
  owner: WorkloadIdentityOwner
  /**
   * Lifetime in seconds, for a relying party whose own token inherits it
   * (Databricks). Defaults to {@link WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS}.
   */
  ttlSeconds?: number
}

/** Signs one short-lived token for a single credential resolution. */
export async function mintWorkloadIdentityToken(
  input: MintWorkloadIdentityTokenInput
): Promise<string> {
  assertWorkloadIdentitySubjectOwner(input.subject, input.owner)
  const ttl = input.ttlSeconds ?? WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS) {
    throw new Error('Workload identity token lifetime must be between 1 second and an hour')
  }
  const { privateKey, kid } = await loadSigningMaterial()
  const claims: Record<string, string> = {}
  if (input.owner.workspaceId) claims.sim_workspace_id = input.owner.workspaceId
  if (input.owner.organizationId) claims.sim_organization_id = input.owner.organizationId
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT(claims)
    .setProtectedHeader({ alg: WORKLOAD_IDENTITY_ALGORITHM, kid, typ: 'JWT' })
    .setIssuer(getWorkloadIdentityIssuer())
    .setSubject(input.subject)
    .setAudience(input.audience)
    .setIssuedAt(now)
    .setNotBefore(now - 30)
    .setExpirationTime(now + ttl)
    .setJti(generateId())
    .sign(privateKey)
}
