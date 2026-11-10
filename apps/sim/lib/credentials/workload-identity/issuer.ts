import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { calculateJwkThumbprint, type JWK, SignJWT } from 'jose'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

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

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const

export class WorkloadIdentityNotConfiguredError extends Error {
  constructor() {
    super('Workload identity is not configured on this deployment')
    this.name = 'WorkloadIdentityNotConfiguredError'
  }
}

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
      const privateKey = createPrivateKey(normalizePem(signingKey))
      const current = await toPublicJwk(privateKey)
      const keys = [current]
      const previousKey = env.WORKLOAD_IDENTITY_PREVIOUS_KEY
      if (previousKey) {
        const previous = await toPublicJwk(createPublicKey(normalizePem(previousKey)))
        if (previous.kid !== current.kid) keys.push(previous)
      }
      return { privateKey, kid: current.kid as string, jwks: { keys } }
    })()
    signingMaterial.catch((error: unknown) => {
      logger.error('Workload identity signing key is set but unusable', { error })
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
}

/** Signs one short-lived token for a single credential resolution. */
export async function mintWorkloadIdentityToken(
  input: MintWorkloadIdentityTokenInput
): Promise<string> {
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
    .setExpirationTime(now + WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS)
    .setJti(generateId())
    .sign(privateKey)
}
