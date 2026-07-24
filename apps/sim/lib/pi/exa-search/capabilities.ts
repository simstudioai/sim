import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { piSearchCapabilities } from '@sim/db/schema'
import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'

const FINGERPRINT_VERSION = 1
const FINGERPRINT_DOMAIN = 'pi-search:fingerprint:v1'
const KEY_ID_DOMAIN = 'pi-search:key-id:v1'
const CAPABILITY_GRACE_MS = 5 * 60 * 1000
export const PI_SEARCH_MAX_CALLS = 10
export const PI_SEARCH_MAX_OUTPUT_BYTES = 500 * 1024
export const PI_SEARCH_MAX_CALL_OUTPUT_BYTES = 100 * 1024
const PI_SEARCH_LEASE_MS = 45_000

export interface SecretFingerprint {
  length: number
  digest: string
  prefix?: string
}

export interface PiSearchCapability {
  id: string
  workspaceId: string
  providerKeyId: string
  executionId: string
  expiresAt: Date
  secretFingerprints: SecretFingerprint[]
}

export interface CreatedPiSearchCapability {
  id: string
  token: string
  expiresAt: Date
  extensionFingerprints: SecretFingerprint[]
}

export interface PiSearchLease {
  capabilityId: string
  token: string
  generation: number
  workspaceId: string
  executionId: string
  expiresAt: Date
}

function requireFingerprintSecret(): string {
  if (!env.INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET is required for Pi internet search')
  }
  return env.INTERNAL_API_SECRET
}

function credentialPrefix(value: string): string | undefined {
  return /^(?:github_pat_|gh[pousr]_|sk-|gsk_|xai-|AIza|AKIA|exa[_-])/.exec(value)?.[0]
}

function fingerprint(value: string, secret: string, domain: string): SecretFingerprint {
  return {
    length: value.length,
    digest: hmacSha256Hex(`${domain}:${value}`, secret),
    ...(credentialPrefix(value) ? { prefix: credentialPrefix(value) } : {}),
  }
}

function representations(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => (value ? [value, encodeURIComponent(value)] : [])).filter(Boolean)
    ),
  ]
}

function parseFingerprints(value: unknown): SecretFingerprint[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is SecretFingerprint =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as SecretFingerprint).length === 'number' &&
      typeof (item as SecretFingerprint).digest === 'string'
  )
}

export function queryContainsProtectedSecret(
  query: string,
  fingerprints: readonly SecretFingerprint[]
): boolean {
  const secret = requireFingerprintSecret()
  for (const protectedValue of fingerprints) {
    if (protectedValue.length < 1 || protectedValue.length > query.length) continue
    const indices: number[] = []
    if (protectedValue.prefix) {
      let index = query.indexOf(protectedValue.prefix)
      while (index !== -1) {
        indices.push(index)
        index = query.indexOf(protectedValue.prefix, index + 1)
      }
    } else {
      for (let index = 0; index <= query.length - protectedValue.length; index++) {
        indices.push(index)
      }
    }
    for (const index of indices) {
      if (index + protectedValue.length > query.length) continue
      const candidate = query.slice(index, index + protectedValue.length)
      const digest = hmacSha256Hex(`${FINGERPRINT_DOMAIN}:${candidate}`, secret)
      if (safeCompare(digest, protectedValue.digest)) return true
    }
  }
  return false
}

export async function createPiSearchCapability(params: {
  workspaceId: string
  executionId: string
  protectedSecrets: readonly string[]
  extensionFingerprintSecrets?: readonly string[]
  providerKeyId: string
}): Promise<CreatedPiSearchCapability> {
  const token = randomBytes(32).toString('base64url')
  const secret = requireFingerprintSecret()
  const expiresAt = new Date(Date.now() + getMaxExecutionTimeout() + CAPABILITY_GRACE_MS)
  const protectedRepresentations = representations(params.protectedSecrets)
  const secretFingerprints = protectedRepresentations.map((value) =>
    fingerprint(value, secret, FINGERPRINT_DOMAIN)
  )
  const extensionSecret = hmacSha256Hex('pi-search:extension-secret-scan:v1', token)
  const extensionFingerprints = representations(params.extensionFingerprintSecrets ?? []).map(
    (value) => fingerprint(value, extensionSecret, 'pi-search:extension-secret-scan:v1')
  )
  const id = generateId()

  await db.insert(piSearchCapabilities).values({
    id,
    capabilityHash: sha256Hex(token),
    workspaceId: params.workspaceId,
    providerKeyId: params.providerKeyId,
    executionId: params.executionId,
    expiresAt,
    maxCalls: PI_SEARCH_MAX_CALLS,
    maxOutputBytes: PI_SEARCH_MAX_OUTPUT_BYTES,
    fingerprintVersion: FINGERPRINT_VERSION,
    fingerprintKeyId: hmacSha256Hex(KEY_ID_DOMAIN, secret).slice(0, 16),
    secretFingerprints,
  })

  return { id, token, expiresAt, extensionFingerprints }
}

export async function authenticatePiSearchCapability(
  token: string
): Promise<PiSearchCapability | null> {
  const capabilityHash = sha256Hex(token)
  const [row] = await db
    .select()
    .from(piSearchCapabilities)
    .where(
      and(
        eq(piSearchCapabilities.capabilityHash, capabilityHash),
        isNull(piSearchCapabilities.revokedAt)
      )
    )
    .limit(1)
  if (!row || row.expiresAt <= new Date() || !safeCompare(row.capabilityHash, capabilityHash)) {
    return null
  }
  const currentKeyId = hmacSha256Hex(KEY_ID_DOMAIN, requireFingerprintSecret()).slice(0, 16)
  if (
    row.fingerprintVersion !== FINGERPRINT_VERSION ||
    !safeCompare(row.fingerprintKeyId, currentKeyId)
  ) {
    await revokePiSearchCapability(row.id)
    return null
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    providerKeyId: row.providerKeyId,
    executionId: row.executionId,
    expiresAt: row.expiresAt,
    secretFingerprints: parseFingerprints(row.secretFingerprints),
  }
}

export async function reservePiSearchCall(
  capability: PiSearchCapability
): Promise<PiSearchLease | null> {
  const leaseToken = randomBytes(18).toString('base64url')
  const [row] = await db.execute<{
    lease_generation: number
    workspace_id: string
    execution_id: string
    lease_expires_at: string | Date
  }>(sql`
    UPDATE pi_search_capabilities
    SET
      call_count = call_count + 1,
      reserved_output_bytes = CASE
        WHEN lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
          THEN ${PI_SEARCH_MAX_CALL_OUTPUT_BYTES}
        ELSE reserved_output_bytes + ${PI_SEARCH_MAX_CALL_OUTPUT_BYTES}
      END,
      lease_token = ${leaseToken},
      lease_generation = lease_generation + 1,
      lease_expires_at = LEAST(
        expires_at,
        NOW() + (${PI_SEARCH_LEASE_MS} * INTERVAL '1 millisecond')
      ),
      updated_at = NOW()
    WHERE id = ${capability.id}
      AND revoked_at IS NULL
      AND expires_at > NOW()
      AND call_count < max_calls
      AND (
        lease_token IS NULL
        OR lease_expires_at < NOW()
      )
      AND settled_output_bytes + ${PI_SEARCH_MAX_CALL_OUTPUT_BYTES} <= max_output_bytes
    RETURNING lease_generation, workspace_id, execution_id, lease_expires_at
  `)
  if (!row) return null
  return {
    capabilityId: capability.id,
    token: leaseToken,
    generation: row.lease_generation,
    workspaceId: row.workspace_id,
    executionId: row.execution_id,
    expiresAt: new Date(row.lease_expires_at),
  }
}

export async function isPiSearchLeaseCurrent(lease: PiSearchLease): Promise<boolean> {
  const [row] = await db
    .select({ id: piSearchCapabilities.id })
    .from(piSearchCapabilities)
    .where(
      and(
        eq(piSearchCapabilities.id, lease.capabilityId),
        eq(piSearchCapabilities.leaseToken, lease.token),
        eq(piSearchCapabilities.leaseGeneration, lease.generation),
        isNull(piSearchCapabilities.revokedAt),
        sql`${piSearchCapabilities.leaseExpiresAt} > NOW()`,
        sql`${piSearchCapabilities.expiresAt} > NOW()`
      )
    )
    .limit(1)
  return Boolean(row)
}

export async function settlePiSearchCall(
  lease: PiSearchLease,
  outputBytes: number
): Promise<boolean> {
  const actualBytes = Math.max(0, Math.min(outputBytes, PI_SEARCH_MAX_CALL_OUTPUT_BYTES))
  const rows = await db
    .update(piSearchCapabilities)
    .set({
      settledOutputBytes: sql`${piSearchCapabilities.settledOutputBytes} + ${actualBytes}`,
      reservedOutputBytes: sql`GREATEST(${piSearchCapabilities.reservedOutputBytes} - ${PI_SEARCH_MAX_CALL_OUTPUT_BYTES}, 0)`,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(piSearchCapabilities.id, lease.capabilityId),
        eq(piSearchCapabilities.leaseToken, lease.token),
        eq(piSearchCapabilities.leaseGeneration, lease.generation),
        isNull(piSearchCapabilities.revokedAt),
        sql`${piSearchCapabilities.leaseExpiresAt} > NOW()`,
        sql`${piSearchCapabilities.expiresAt} > NOW()`
      )
    )
    .returning({ id: piSearchCapabilities.id })
  return rows.length === 1
}

export async function releasePiSearchCall(lease: PiSearchLease): Promise<boolean> {
  const rows = await db
    .update(piSearchCapabilities)
    .set({
      reservedOutputBytes: sql`GREATEST(${piSearchCapabilities.reservedOutputBytes} - ${PI_SEARCH_MAX_CALL_OUTPUT_BYTES}, 0)`,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(piSearchCapabilities.id, lease.capabilityId),
        eq(piSearchCapabilities.leaseToken, lease.token),
        eq(piSearchCapabilities.leaseGeneration, lease.generation)
      )
    )
    .returning({ id: piSearchCapabilities.id })
  return rows.length === 1
}

export async function revokePiSearchCapability(id: string): Promise<void> {
  await db
    .update(piSearchCapabilities)
    .set({ revokedAt: new Date(), leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(eq(piSearchCapabilities.id, id))
}

export async function cleanupExpiredPiSearchCapabilities(params: {
  batchSize: number
  retentionBefore: Date
}): Promise<number> {
  const retentionBefore = params.retentionBefore.toISOString()
  const rows = await db.execute<{ id: string }>(sql`
    WITH candidates AS (
      SELECT id
      FROM pi_search_capabilities
      WHERE expires_at < ${retentionBefore}::timestamp
         OR revoked_at < ${retentionBefore}::timestamp
      ORDER BY expires_at
      LIMIT ${params.batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM pi_search_capabilities target
    USING candidates
    WHERE target.id = candidates.id
    RETURNING target.id
  `)
  return rows.length
}
