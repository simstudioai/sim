import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
} from '@sim/db/schema'
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm'

export const MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE = 100

export interface CredentialGroupCredentialListContext {
  credentialGroupId: string
  workspaceId: string
  name: string
  status: 'active' | 'disabled'
  options: CredentialGroupOptionConfig[]
}

export interface CredentialGroupCredentialReference {
  credentialId: string
  email: string
  displayName: string
  providerId: string
  providerSubjectId: string
  providerTenantId: string | null
}

export class CredentialGroupCredentialCursorNotFoundError extends Error {
  constructor() {
    super('Credential group credential cursor not found')
    this.name = 'CredentialGroupCredentialCursorNotFoundError'
  }
}

interface ListCredentialGroupCredentialReferencesInput {
  workspaceId: string
  credentialGroupId: string
  limit: number
  cursor?: string
  email?: string
  credentialProviderIds?: string[]
  credentialGroupOptionIds: string[]
}

/** Loads the canonical group ownership needed by the application authorization boundary. */
export async function loadCredentialGroupCredentialListContext(
  credentialGroupId: string
): Promise<CredentialGroupCredentialListContext | null> {
  const [row] = await db
    .select({
      credentialGroupId: credentialGroup.id,
      workspaceId: credentialGroup.workspaceId,
      name: credentialGroup.name,
      status: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .where(eq(credentialGroup.id, credentialGroupId))
    .limit(1)
  return row ?? null
}

/** Lists one bounded page of active managed credentials without selecting token material. */
export async function listCredentialGroupCredentialReferences({
  workspaceId,
  credentialGroupId,
  limit,
  cursor,
  email,
  credentialProviderIds,
  credentialGroupOptionIds,
}: ListCredentialGroupCredentialReferencesInput): Promise<{
  credentials: CredentialGroupCredentialReference[]
  nextCursor: string | null
}> {
  if (credentialGroupOptionIds.length === 0) {
    if (cursor) throw new CredentialGroupCredentialCursorNotFoundError()
    return { credentials: [], nextCursor: null }
  }

  let cursorPosition: { id: string; createdAt: Date } | undefined
  if (cursor) {
    const [cursorRow] = await db
      .select({ id: credential.id, createdAt: credential.createdAt })
      .from(credential)
      .innerJoin(
        credentialGroupEnrollment,
        eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
      )
      .where(
        and(
          eq(credential.id, cursor),
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'managed_oauth'),
          eq(credential.managedOauthStatus, 'active'),
          eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
          inArray(credential.credentialGroupOptionId, credentialGroupOptionIds),
          email ? eq(credentialGroupEnrollment.email, email) : undefined,
          credentialProviderIds?.length
            ? inArray(credential.providerId, credentialProviderIds)
            : undefined,
          inArray(credentialGroupEnrollment.status, ['in_progress', 'completed'])
        )
      )
      .limit(1)
    if (!cursorRow) throw new CredentialGroupCredentialCursorNotFoundError()
    cursorPosition = cursorRow
  }

  const rows = await db
    .select({
      id: credential.id,
      email: credentialGroupEnrollment.email,
      displayName: credential.displayName,
      providerId: credential.providerId,
      providerSubjectId: credential.providerSubjectId,
      providerTenantId: credential.providerTenantId,
      createdAt: credential.createdAt,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.managedOauthStatus, 'active'),
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
        inArray(credential.credentialGroupOptionId, credentialGroupOptionIds),
        email ? eq(credentialGroupEnrollment.email, email) : undefined,
        credentialProviderIds?.length
          ? inArray(credential.providerId, credentialProviderIds)
          : undefined,
        inArray(credentialGroupEnrollment.status, ['in_progress', 'completed']),
        cursorPosition
          ? or(
              gt(credential.createdAt, cursorPosition.createdAt),
              and(
                eq(credential.createdAt, cursorPosition.createdAt),
                gt(credential.id, cursorPosition.id)
              )
            )
          : undefined
      )
    )
    .orderBy(asc(credential.createdAt), asc(credential.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? pageRows.at(-1)?.id : null
  if (hasMore && !nextCursor) throw new Error('Credential page cursor could not be derived')
  return {
    credentials: pageRows.map((row) => {
      if (!row.providerId) throw new Error(`Managed credential ${row.id} has no provider ID`)
      if (!row.providerSubjectId) {
        throw new Error(`Managed credential ${row.id} has no provider subject ID`)
      }
      return {
        credentialId: row.id,
        email: row.email,
        displayName: row.displayName,
        providerId: row.providerId,
        providerSubjectId: row.providerSubjectId,
        providerTenantId: row.providerTenantId,
      }
    }),
    nextCursor: nextCursor ?? null,
  }
}
