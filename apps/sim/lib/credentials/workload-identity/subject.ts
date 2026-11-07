import { createHmac } from 'node:crypto'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import type { WorkloadIdentityOwner } from '@/lib/credentials/workload-identity/issuer'

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

/** `sim:workspace:<id>:credential:<subjectId>` (or `sim:organization:…`). */
function buildWorkloadIdentitySubject(owner: WorkloadIdentityOwner, subjectId: string): string {
  if (!SUBJECT_ID_PATTERN.test(subjectId)) {
    throw new WorkloadIdentitySubjectError('Invalid workload identity subject')
  }
  return `sim:${ownerSegment(owner)}:credential:${subjectId}`
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
  const subject = buildWorkloadIdentitySubject(owner, generateId().replace(/-/g, ''))
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
  if (!subject.startsWith(`sim:${ownerSegment(owner)}:credential:`)) throw invalid()
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
