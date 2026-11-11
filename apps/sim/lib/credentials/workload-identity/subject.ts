import { createHmac } from 'node:crypto'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret } from '@/lib/core/security/encryption'
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import type { WorkloadIdentityOwner } from '@/lib/credentials/workload-identity/issuer'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'
import {
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

const logger = createLogger('WorkloadIdentitySubject')

/**
 * Credential-scoped workload-identity subjects.
 *
 * A customer's trust policy pins one subject, so the subject — not the
 * workspace — is what a cloud role trusts. Sim generates the random part and
 * signs it for the preparing user and owner: a member who learns another
 * credential's subject (it is visible in that customer's trust policy) cannot
 * attach it to a credential of their own, because only Sim can produce a proof
 * for it, and only for the person it was issued to.
 */

const SUBJECT_PROOF_TTL_MS = 24 * 60 * 60 * 1000
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** Who owns a credential with a bound subject, and who is saving it. */
export interface WorkloadIdentityCredentialOwner extends WorkloadIdentityOwner {
  /** The person creating or reconnecting the credential. */
  actorUserId: string
  /** Decrypted secret of the credential being reconnected, if any. */
  storedSecret?: Record<string, unknown> | null
}

export class WorkloadIdentitySubjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkloadIdentitySubjectError'
  }
}

function ownerSegment(owner: WorkloadIdentityOwner): string {
  if (owner.workspaceId && !owner.organizationId) return `workspace:${owner.workspaceId}`
  if (owner.organizationId && !owner.workspaceId) return `organization:${owner.organizationId}`
  throw new WorkloadIdentitySubjectError('A workload identity subject needs exactly one owner')
}

function subjectPrefix(owner: WorkloadIdentityOwner): string {
  return `sim:${ownerSegment(owner)}:credential:`
}

/** Throws unless the subject was built for this owner. */
export function assertWorkloadIdentitySubjectOwner(
  subject: string,
  owner: WorkloadIdentityOwner
): void {
  if (!subject.startsWith(subjectPrefix(owner))) {
    throw new WorkloadIdentitySubjectError('Workload identity subject belongs to another owner')
  }
}

/** `sim:workspace:<id>:credential:<subjectId>` (or `sim:organization:…`). */
function buildWorkloadIdentitySubject(owner: WorkloadIdentityOwner, subjectId: string): string {
  if (!SUBJECT_ID_PATTERN.test(subjectId)) {
    throw new WorkloadIdentitySubjectError('Invalid workload identity subject')
  }
  return `${subjectPrefix(owner)}${subjectId}`
}

function proofKey(): Buffer {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update('sim/workload-identity-subject/v1')
    .digest()
}

function sign(
  provider: WorkloadIdentityProvider,
  owner: WorkloadIdentityOwner,
  userId: string,
  subject: string,
  expiresAt: number
) {
  return createHmac('sha256', proofKey())
    .update(`${provider}|${ownerSegment(owner)}|${userId}|${subject}|${expiresAt}`, 'utf8')
    .digest('base64url')
}

/** A fresh subject for this owner that no credential holds yet. */
export function newWorkloadIdentitySubject(owner: WorkloadIdentityOwner): string {
  return buildWorkloadIdentitySubject(owner, generateId().replace(/-/g, ''))
}

export interface WorkloadIdentitySubjectGrant {
  subject: string
  subjectProof: string
  expiresAt: string
}

/** Issues a fresh subject the given user can attach to a new credential of one provider. */
export function issueWorkloadIdentitySubject(
  provider: WorkloadIdentityProvider,
  owner: WorkloadIdentityOwner,
  userId: string,
  now: number = Date.now()
): WorkloadIdentitySubjectGrant {
  const subject = newWorkloadIdentitySubject(owner)
  const expiresAt = now + SUBJECT_PROOF_TTL_MS
  return {
    subject,
    subjectProof: `${expiresAt}.${sign(provider, owner, userId, subject, expiresAt)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/**
 * Throws unless the proof was issued by Sim for this provider, owner, user, and
 * subject and has not expired.
 */
export function verifyWorkloadIdentitySubject(
  provider: WorkloadIdentityProvider,
  owner: WorkloadIdentityOwner,
  userId: string,
  subject: string,
  subjectProof: string,
  now: number = Date.now()
): void {
  const invalid = () =>
    new WorkloadIdentitySubjectError(
      'This trust setup has expired or belongs to someone else. Start the keyless connection again.'
    )
  const separator = subjectProof.indexOf('.')
  if (separator <= 0) throw invalid()
  const expiresAt = Number(subjectProof.slice(0, separator))
  const signature = subjectProof.slice(separator + 1)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw invalid()
  if (!subject.startsWith(subjectPrefix(owner))) throw invalid()
  if (!safeCompare(signature, sign(provider, owner, userId, subject, expiresAt))) throw invalid()
}

/**
 * Decides which subject a keyless credential is saved with.
 *
 * - No subject submitted: a reconnect keeping the trust the customer already
 *   configured — the stored subject is reused, and there must be one.
 * - The stored subject resubmitted: kept as-is.
 * - Any other subject: must carry a fresh proof Sim issued to this person, for
 *   this owner and provider.
 */
export function bindWorkloadIdentitySubject(input: {
  provider: WorkloadIdentityProvider
  owner: WorkloadIdentityCredentialOwner
  storedSubject: string | undefined
  subject: string | undefined
  subjectProof: string | undefined
}): string {
  const { provider, owner, storedSubject, subject, subjectProof } = input
  if (!subject || subject === storedSubject) {
    if (storedSubject) return storedSubject
    throw new WorkloadIdentitySubjectError('Start a keyless connection to get a trust setup first.')
  }
  if (!subjectProof) {
    throw new WorkloadIdentitySubjectError('Start a keyless connection to get a trust setup first.')
  }
  verifyWorkloadIdentitySubject(provider, owner, owner.actorUserId, subject, subjectProof)
  return subject
}

/** Providers whose stored secret can hold a bound subject at `config.subject`. */
const KEYLESS_PROVIDER_IDS = [
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
]

/** The part of an AWS or Databricks stored secret that can hold a bound subject. */
const storedSubjectSchema = z.object({
  config: z.object({ subject: z.string().optional() }),
})

/** The subject a stored secret holds, `undefined` for a keyed mode, or `null` when unreadable. */
async function readStoredSubject(encrypted: string): Promise<string | undefined | null> {
  try {
    const { decrypted } = await decryptSecret(encrypted)
    const parsed = storedSubjectSchema.safeParse(JSON.parse(decrypted))
    return parsed.success ? parsed.data.config.subject : null
  } catch {
    return null
  }
}

function lockSubject(tx: DbTransaction, subject: string): Promise<void> {
  return acquireAdvisoryXactLock(
    tx,
    'workload_identity_subject',
    `workload-identity-subject:${subject}`
  )
}

/** Names the owner without naming a credential, which the caller may not be able to see. */
function scopeNoun(scope: ResourceScope): string {
  return scope.kind === 'workspace' ? 'this workspace' : 'this organization'
}

/** Throws unless no live keyless credential of the owner other than `credentialId` holds `subject`. */
async function assertNoOtherCredentialHolds(
  tx: DbTransaction,
  input: { subject: string; scope: ResourceScope; credentialId?: string }
): Promise<void> {
  const rows = await tx
    .select({
      id: credential.id,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(
      and(
        resourceScopeCondition(credential, input.scope),
        inArray(credential.providerId, KEYLESS_PROVIDER_IDS),
        isNull(credential.revokedAt),
        input.credentialId ? ne(credential.id, input.credentialId) : undefined
      )
    )
  for (const row of rows) {
    if (!row.encryptedServiceAccountKey) continue
    const storedSubject = await readStoredSubject(row.encryptedServiceAccountKey)
    if (storedSubject === null) {
      logger.warn('Unreadable keyless credential blocks a subject uniqueness check', {
        credentialId: row.id,
      })
      throw new WorkloadIdentitySubjectError(
        `Sim could not read another keyless credential in ${scopeNoun(input.scope)}, so it cannot confirm this trust setup is unused. Ask an admin to reconnect or delete the broken keyless credential, then try again.`
      )
    }
    if (storedSubject === input.subject) {
      throw new WorkloadIdentitySubjectError(
        `Another credential in ${scopeNoun(input.scope)} already uses this trust setup. Start the keyless connection again.`
      )
    }
  }
}

/**
 * Refuses a subject that another live credential of the same owner already
 * holds. A proof stays valid for a day and is not tied to one credential, so
 * without this a member removed from a keyless credential could save a second
 * credential with the same subject and keep assuming the customer's role.
 *
 * The subject lives only inside each credential's encrypted secret, so this
 * decrypts the owner's keyless credentials (one owner holds few) rather than
 * relying on a unique index. It runs inside the transaction that writes the
 * credential: the advisory lock holds concurrent saves of one subject until
 * commit, so the later save sees the earlier row. A sibling whose secret cannot
 * be read might hold the subject, so it refuses the save rather than skip it.
 *
 * Caveats: uniqueness holds only within one owner (a subject embeds its owner,
 * so another owner's credential cannot hold it), only among live AWS and
 * Databricks keyless credentials, and only for writers that call this inside
 * their write transaction. The refusal never names the sibling, which the
 * caller may not be able to see.
 */
export async function assertWorkloadIdentitySubjectUnclaimed(
  tx: DbTransaction,
  input: { subject: string; scope: ResourceScope }
): Promise<void> {
  await lockSubject(tx, input.subject)
  await assertNoOtherCredentialHolds(tx, input)
}

/**
 * The reconnect counterpart of {@link assertWorkloadIdentitySubjectUnclaimed},
 * run in the transaction that writes `rotatedSecret` onto `credentialId`.
 *
 * Whether the reconnect keeps the credential's subject is decided here, from
 * the row as it stands under the lock, not from the secret read before
 * provider verification: while that verification ran, another reconnect could
 * have moved this credential to a different subject and a second credential
 * could have claimed the old one, so writing it back unchecked would leave two
 * credentials holding it. Locks the subject first, then the credential row; no
 * path takes a subject lock while holding a credential row, so the order cannot
 * deadlock.
 */
export async function assertReconnectedSubjectUnclaimed(
  tx: DbTransaction,
  input: { rotatedSecret: string; scope: ResourceScope; credentialId: string }
): Promise<void> {
  const subject = await readStoredSubject(input.rotatedSecret)
  if (!subject) return
  await lockSubject(tx, subject)
  const [current] = await tx
    .select({ encryptedServiceAccountKey: credential.encryptedServiceAccountKey })
    .from(credential)
    .where(eq(credential.id, input.credentialId))
    .for('update')
  const currentSubject = current?.encryptedServiceAccountKey
    ? await readStoredSubject(current.encryptedServiceAccountKey)
    : undefined
  if (currentSubject === subject) return
  await assertNoOtherCredentialHolds(tx, {
    subject,
    scope: input.scope,
    credentialId: input.credentialId,
  })
}
