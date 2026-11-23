import { db } from '@sim/db'
import { workloadIdentityPendingSubject } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, gt, inArray, lte } from 'drizzle-orm'
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import {
  isWorkloadIdentitySubjectHeld,
  lockWorkloadIdentitySubject,
  newWorkloadIdentitySubject,
  WorkloadIdentitySubjectError,
} from '@/lib/credentials/workload-identity/subject'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

/**
 * How long Sim holds an unsaved keyless subject for the person it was issued to.
 * Each time the subject is shown or its proof renewed, the hold restarts, so a
 * trust policy that takes days of review can still be saved against it.
 */
export const PENDING_SUBJECT_HOLD_MS = 30 * 24 * 60 * 60 * 1000

/** Most pending subjects one person keeps per workspace and provider; the least recently shown are dropped. */
const MAX_PENDING_SUBJECTS_PER_ISSUER = 20

/** Who a pending subject is held for. */
export interface PendingSubjectIssuer {
  provider: WorkloadIdentityProvider
  workspaceId: string
  userId: string
}

/**
 * Which subject to hand out:
 * - `latest`: the newest subject still held for this person, else a new one (the connect dialog).
 * - `new`: always a new one (the API's default, so scripts setting up several credentials get one each).
 * - `renew`: exactly `subject`, which must still be held for this person.
 */
export type PendingSubjectRequest =
  | { kind: 'latest' }
  | { kind: 'new' }
  | { kind: 'renew'; subject: string }

/** A subject Sim holds for one person until a credential saves it. */
export interface PendingSubject {
  subject: string
  /** When Sim first issued the subject. */
  issuedAt: Date
  /** Until when Sim keeps offering the subject if no credential saves it. */
  heldUntil: Date
  /** Whether the subject was issued earlier rather than by this request. */
  reused: boolean
}

function issuerCondition(issuer: PendingSubjectIssuer) {
  return and(
    eq(workloadIdentityPendingSubject.workspaceId, issuer.workspaceId),
    eq(workloadIdentityPendingSubject.userId, issuer.userId),
    eq(workloadIdentityPendingSubject.provider, issuer.provider)
  )
}

async function mintPendingSubject(
  tx: DbTransaction,
  issuer: PendingSubjectIssuer,
  now: Date
): Promise<PendingSubject> {
  const heldUntil = new Date(now.getTime() + PENDING_SUBJECT_HOLD_MS)
  const subject = newWorkloadIdentitySubject({ workspaceId: issuer.workspaceId })
  await tx.insert(workloadIdentityPendingSubject).values({
    id: generateId(),
    workspaceId: issuer.workspaceId,
    userId: issuer.userId,
    provider: issuer.provider,
    subject,
    createdAt: now,
    expiresAt: heldUntil,
  })
  const kept = await tx
    .select({ id: workloadIdentityPendingSubject.id })
    .from(workloadIdentityPendingSubject)
    .where(issuerCondition(issuer))
    .orderBy(desc(workloadIdentityPendingSubject.expiresAt))
    .offset(MAX_PENDING_SUBJECTS_PER_ISSUER)
  if (kept.length > 0) {
    await tx.delete(workloadIdentityPendingSubject).where(
      inArray(
        workloadIdentityPendingSubject.id,
        kept.map((row) => row.id)
      )
    )
  }
  return { subject, issuedAt: now, heldUntil, reused: false }
}

/**
 * Restarts the hold on a still-pending subject, or drops it when a credential already
 * holds it: a deployment that predates releasing pending subjects leaves the row
 * behind after a save, and a subject in use is never offered again.
 */
async function renewIfUnclaimed(
  tx: DbTransaction,
  issuer: PendingSubjectIssuer,
  row: { id: string; subject: string; createdAt: Date },
  now: Date
): Promise<PendingSubject | null> {
  // Waits out a save of this subject still in flight, so the check below sees it.
  await lockWorkloadIdentitySubject(tx, row.subject)
  const held = await isWorkloadIdentitySubjectHeld(tx, {
    subject: row.subject,
    scope: { kind: 'workspace', workspaceId: issuer.workspaceId },
  })
  if (held) {
    await tx
      .delete(workloadIdentityPendingSubject)
      .where(eq(workloadIdentityPendingSubject.id, row.id))
    return null
  }
  const heldUntil = new Date(now.getTime() + PENDING_SUBJECT_HOLD_MS)
  // A save that claimed the subject meanwhile has already deleted the row.
  const renewed = await tx
    .update(workloadIdentityPendingSubject)
    .set({ expiresAt: heldUntil })
    .where(eq(workloadIdentityPendingSubject.id, row.id))
    .returning({ id: workloadIdentityPendingSubject.id })
  if (renewed.length === 0) return null
  return { subject: row.subject, issuedAt: row.createdAt, heldUntil, reused: true }
}

/**
 * The keyless subject to show this person, held for them until a credential saves
 * it or {@link PENDING_SUBJECT_HOLD_MS} passes without it being shown again.
 * Requests for one person, workspace, and provider run one at a time, so two
 * dialogs opened together do not each mint a subject.
 */
export async function resolvePendingWorkloadIdentitySubject(
  issuer: PendingSubjectIssuer,
  request: PendingSubjectRequest,
  now: Date = new Date()
): Promise<PendingSubject> {
  const pending = await db.transaction(async (tx): Promise<PendingSubject | null> => {
    await acquireAdvisoryXactLock(
      tx,
      'workload_identity_pending_subject',
      `workload-identity-pending-subject:${issuer.workspaceId}:${issuer.userId}:${issuer.provider}`
    )
    await tx
      .delete(workloadIdentityPendingSubject)
      .where(and(issuerCondition(issuer), lte(workloadIdentityPendingSubject.expiresAt, now)))

    if (request.kind === 'new') return mintPendingSubject(tx, issuer, now)

    const candidates = await tx
      .select({
        id: workloadIdentityPendingSubject.id,
        subject: workloadIdentityPendingSubject.subject,
        createdAt: workloadIdentityPendingSubject.createdAt,
      })
      .from(workloadIdentityPendingSubject)
      .where(
        and(
          issuerCondition(issuer),
          gt(workloadIdentityPendingSubject.expiresAt, now),
          request.kind === 'renew'
            ? eq(workloadIdentityPendingSubject.subject, request.subject)
            : undefined
        )
      )
      .orderBy(desc(workloadIdentityPendingSubject.createdAt))

    for (const row of candidates) {
      const renewed = await renewIfUnclaimed(tx, issuer, row, now)
      if (renewed) return renewed
    }
    // A refused renewal still commits the cleanup above, so it is reported after the transaction.
    if (request.kind === 'renew') return null
    return mintPendingSubject(tx, issuer, now)
  })
  if (!pending) {
    throw new WorkloadIdentitySubjectError(
      'Sim is not holding this subject for you: it was issued to someone else, a credential already uses it, or it expired. Request a new subject and trust it instead.',
      'WORKLOAD_IDENTITY_SUBJECT_NOT_PENDING'
    )
  }
  return pending
}

/**
 * Stops holding `subject` once a credential saves it, inside the transaction that
 * writes the credential, so a subject in use is never offered again, even after
 * that credential is deleted.
 */
export async function releasePendingWorkloadIdentitySubject(
  tx: DbTransaction,
  subject: string
): Promise<void> {
  await tx
    .delete(workloadIdentityPendingSubject)
    .where(eq(workloadIdentityPendingSubject.subject, subject))
}
