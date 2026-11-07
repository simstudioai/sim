import { createHmac } from 'node:crypto'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
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
export function buildWorkloadIdentitySubject(
  owner: WorkloadIdentityOwner,
  subjectId: string
): string {
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

function sign(owner: WorkloadIdentityOwner, userId: string, subject: string, expiresAt: number) {
  return createHmac('sha256', proofKey())
    .update(`${ownerSegment(owner)}|${userId}|${subject}|${expiresAt}`, 'utf8')
    .digest('base64url')
}

export interface WorkloadIdentitySubjectGrant {
  subject: string
  subjectProof: string
  expiresAt: string
}

/** Issues a fresh subject the given user can attach to one new credential. */
export function issueWorkloadIdentitySubject(
  owner: WorkloadIdentityOwner,
  userId: string,
  now: number = Date.now()
): WorkloadIdentitySubjectGrant {
  const subject = buildWorkloadIdentitySubject(owner, generateId().replace(/-/g, ''))
  const expiresAt = now + SUBJECT_PROOF_TTL_MS
  return {
    subject,
    subjectProof: `${expiresAt}.${sign(owner, userId, subject, expiresAt)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/** Throws unless the proof was issued by Sim for this owner, user, and subject and has not expired. */
export function verifyWorkloadIdentitySubject(
  owner: WorkloadIdentityOwner,
  userId: string,
  subject: string,
  subjectProof: string,
  now: number = Date.now()
): void {
  const invalid = () =>
    new WorkloadIdentitySubjectError(
      'This trust setup has expired or belongs to someone else. Start a new AWS role connection.'
    )
  const separator = subjectProof.indexOf('.')
  if (separator <= 0) throw invalid()
  const expiresAt = Number(subjectProof.slice(0, separator))
  const signature = subjectProof.slice(separator + 1)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw invalid()
  if (!subject.startsWith(`sim:${ownerSegment(owner)}:credential:`)) throw invalid()
  if (!safeCompare(signature, sign(owner, userId, subject, expiresAt))) throw invalid()
}
