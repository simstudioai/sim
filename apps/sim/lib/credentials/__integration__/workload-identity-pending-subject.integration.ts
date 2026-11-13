/**
 * Sim holds an unsaved keyless subject for the person it was issued to, so a
 * trust policy applied days after the connect dialog closed still matches: the
 * dialog reopens on the same subject, the proof can be renewed, and a subject
 * a credential has saved is never handed out again.
 */

import { db } from '@sim/db'
import {
  credential,
  permissions,
  user,
  workloadIdentityPendingSubject,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { jsonResponse } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/credentials/workload-identity/issuer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/credentials/workload-identity/issuer')>()),
  isWorkloadIdentityConfigured: async () => true,
  mintWorkloadIdentityToken: async ({ subject }: { subject: string }) => `token-for:${subject}`,
}))

import { updateCredentialRecord } from '@/lib/credentials/orchestration'
import { createCredentialRecord } from '@/lib/credentials/orchestration/credential-create'
import {
  PENDING_SUBJECT_HOLD_MS,
  resolvePendingWorkloadIdentitySubject,
} from '@/lib/credentials/workload-identity/pending-subjects'
import { signWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const HOST = 'dbc-5678abcd-1234.cloud.databricks.com'
const CLIENT_ID = '00000000-0000-0000-0000-000000000000'
const DAY_MS = 24 * 60 * 60 * 1000
const userId = generateId()
const otherUserId = generateId()
const workspaceId = generateId()
const owner = { workspaceId }
const issuer = { provider: 'databricks' as const, workspaceId, userId }
const originalFetch = globalThis.fetch

/** Subjects the fixture service principal's federation policy pins. */
const pinnedSubjects = new Set<string>()

function keyless(subject: string, actor = userId) {
  const { subjectProof } = signWorkloadIdentitySubject('databricks', owner, actor, subject)
  return JSON.stringify({
    authType: 'oidc_federation',
    host: HOST,
    clientId: CLIENT_ID,
    subject,
    subjectProof,
  })
}

function create(displayName: string, serviceAccountJson: string) {
  return createCredentialRecord(
    {
      workspaceId,
      type: 'service_account',
      userId,
      providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
      displayName,
      serviceAccountJson,
    },
    { authorizeWorkspace: true }
  )
}

async function heldSubjects(): Promise<string[]> {
  const rows = await db
    .select({ subject: workloadIdentityPendingSubject.subject })
    .from(workloadIdentityPendingSubject)
    .where(eq(workloadIdentityPendingSubject.workspaceId, workspaceId))
  return rows.map((row) => row.subject)
}

describe('holding an unsaved keyless subject', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [userId, otherUserId].map((id) => ({
        id,
        name: 'Pending subject fixture',
        email: `${id}@pending-subject.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Pending subject fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values(
      [userId, otherUserId].map((id) => ({
        id: generateId(),
        userId: id,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType: 'admin' as const,
      }))
    )

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (target === `https://${HOST}/oidc/v1/token`) {
        const subjectToken = new URLSearchParams(String(init?.body)).get('subject_token') ?? ''
        const subject = subjectToken.replace(/^token-for:/, '')
        return pinnedSubjects.has(subject)
          ? jsonResponse({ access_token: `access-for:${subject}` })
          : jsonResponse({ error: 'invalid_client' }, 401)
      }
      if (target === `https://${HOST}/api/2.0/preview/scim/v2/Me`) {
        return jsonResponse({ userName: 'service-principal@example.com' })
      }
      return originalFetch(input, init)
    })
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [userId, otherUserId]))
  })

  it('reopens on the same subject until a new one is asked for', async () => {
    const first = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'latest' })
    const reopened = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'latest' })
    const fresh = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' })
    const afterFresh = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'latest' })

    expect(reopened).toMatchObject({ subject: first.subject, reused: true })
    expect(reopened.issuedAt.getTime()).toBe(first.issuedAt.getTime())
    expect(fresh.subject).not.toBe(first.subject)
    expect(fresh.reused).toBe(false)
    expect(afterFresh.subject).toBe(fresh.subject)
  })

  it('saves a credential days later on a renewed proof for the held subject', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * DAY_MS)
    const held = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' }, tenDaysAgo)
    pinnedSubjects.add(held.subject)

    const renewed = await resolvePendingWorkloadIdentitySubject(issuer, {
      kind: 'renew',
      subject: held.subject,
    })
    const saved = await create('Renewed lakehouse', keyless(renewed.subject))

    expect(renewed.issuedAt.getTime()).toBe(tenDaysAgo.getTime())
    expect(renewed.heldUntil.getTime()).toBeGreaterThan(
      Date.now() + PENDING_SUBJECT_HOLD_MS - DAY_MS
    )
    expect(saved.success).toBe(true)
  })

  it('never offers a subject again once a credential saved it, even after that credential is gone', async () => {
    const held = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' })
    pinnedSubjects.add(held.subject)
    const saved = await create('Saved lakehouse', keyless(held.subject))
    const savedId = saved.credential?.id ?? ''
    expect(savedId).not.toBe('')

    await db.delete(credential).where(eq(credential.id, savedId))
    const next = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'latest' })

    expect(await heldSubjects()).not.toContain(held.subject)
    expect(next.subject).not.toBe(held.subject)
    await expect(
      resolvePendingWorkloadIdentitySubject(issuer, { kind: 'renew', subject: held.subject })
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_SUBJECT_NOT_PENDING' })
  })

  it('drops a held subject that a credential saved without releasing it', async () => {
    const held = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' })
    pinnedSubjects.add(held.subject)
    const saved = await create('Unreleased lakehouse', keyless(held.subject))
    expect(saved.success).toBe(true)
    // A save on a release without pending subjects leaves the row behind.
    await db.insert(workloadIdentityPendingSubject).values({
      id: generateId(),
      workspaceId,
      userId,
      provider: 'databricks',
      subject: held.subject,
      expiresAt: new Date(Date.now() + DAY_MS),
    })

    const next = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'latest' })

    expect(next.subject).not.toBe(held.subject)
    expect(await heldSubjects()).not.toContain(held.subject)
  })

  it('releases a held subject a reconnect moves the credential onto', async () => {
    const first = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' })
    pinnedSubjects.add(first.subject)
    const saved = await create('Reconnected lakehouse', keyless(first.subject))
    const savedId = saved.credential?.id ?? ''
    expect(savedId).not.toBe('')
    const moved = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' })
    pinnedSubjects.add(moved.subject)

    const [row] = await db.select().from(credential).where(eq(credential.id, savedId))
    const reconnected = await updateCredentialRecord({
      credentialId: savedId,
      credential: row,
      actorUserId: userId,
      serviceAccountJson: keyless(moved.subject),
    })

    expect(reconnected.success).toBe(true)
    expect(await heldSubjects()).not.toContain(moved.subject)
  })

  it('refuses to renew a subject held for someone else', async () => {
    const theirs = await resolvePendingWorkloadIdentitySubject(
      { ...issuer, userId: otherUserId },
      { kind: 'new' }
    )

    await expect(
      resolvePendingWorkloadIdentitySubject(issuer, { kind: 'renew', subject: theirs.subject })
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_SUBJECT_NOT_PENDING' })
  })

  it('stops holding a subject that was not shown again within the hold', async () => {
    const longAgo = new Date(Date.now() - PENDING_SUBJECT_HOLD_MS - DAY_MS)
    const stale = await resolvePendingWorkloadIdentitySubject(issuer, { kind: 'new' }, longAgo)

    await expect(
      resolvePendingWorkloadIdentitySubject(issuer, { kind: 'renew', subject: stale.subject })
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_SUBJECT_NOT_PENDING' })
    expect(await heldSubjects()).not.toContain(stale.subject)
  })

  it('keeps holding a subject while an unreadable sibling credential blocks the check', async () => {
    const google = { ...issuer, provider: 'google' as const }
    const held = await resolvePendingWorkloadIdentitySubject(google, { kind: 'new' })
    const unreadableId = generateId()
    await db.insert(credential).values({
      id: unreadableId,
      workspaceId,
      type: 'service_account',
      displayName: 'Unreadable keyless credential',
      providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
      encryptedServiceAccountKey: 'not-a-ciphertext',
      createdBy: userId,
    })

    const reopened = await resolvePendingWorkloadIdentitySubject(google, { kind: 'latest' })
    await db.delete(credential).where(eq(credential.id, unreadableId))

    expect(reopened).toMatchObject({ subject: held.subject, reused: true })
    expect(await heldSubjects()).toContain(held.subject)
  })

  it('keeps one person from piling up held subjects', async () => {
    const capped = { ...issuer, provider: 'snowflake' as const }
    for (let index = 0; index < 25; index++) {
      await resolvePendingWorkloadIdentitySubject(capped, { kind: 'new' })
    }

    const rows = await db
      .select({ id: workloadIdentityPendingSubject.id })
      .from(workloadIdentityPendingSubject)
      .where(
        and(
          eq(workloadIdentityPendingSubject.workspaceId, workspaceId),
          eq(workloadIdentityPendingSubject.provider, 'snowflake')
        )
      )

    expect(rows.length).toBe(20)
  })
})
