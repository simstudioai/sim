import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import {
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'

export const MAX_CREDENTIAL_GROUP_PAGE_SIZE = 100

export interface CredentialGroupSummary {
  id: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  providerIds: string[]
  createdAt: string
  updatedAt: string
}

export class CredentialGroupCursorNotFoundError extends Error {
  constructor() {
    super('Credential group cursor not found')
    this.name = 'CredentialGroupCursorNotFoundError'
  }
}

interface ListCredentialGroupSummariesInput {
  workspaceId: string
  limit: number
  cursor?: string
}

/** Lists a bounded page of group metadata without decrypting provider configuration. */
export async function listCredentialGroupSummaries({
  workspaceId,
  limit,
  cursor,
}: ListCredentialGroupSummariesInput): Promise<{
  credentialGroups: CredentialGroupSummary[]
  nextCursor: string | null
}> {
  let cursorPosition: { id: string; createdAt: Date } | undefined
  if (cursor) {
    const [cursorRow] = await db
      .select({ id: credentialGroup.id, createdAt: credentialGroup.createdAt })
      .from(credentialGroup)
      .where(and(eq(credentialGroup.id, cursor), eq(credentialGroup.workspaceId, workspaceId)))
      .limit(1)
    if (!cursorRow) throw new CredentialGroupCursorNotFoundError()
    cursorPosition = cursorRow
  }

  const rows = await db
    .select({
      id: credentialGroup.id,
      name: credentialGroup.name,
      description: credentialGroup.description,
      status: credentialGroup.status,
      options: credentialGroup.options,
      createdAt: credentialGroup.createdAt,
      updatedAt: credentialGroup.updatedAt,
    })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.workspaceId, workspaceId),
        cursorPosition
          ? or(
              lt(credentialGroup.createdAt, cursorPosition.createdAt),
              and(
                eq(credentialGroup.createdAt, cursorPosition.createdAt),
                lt(credentialGroup.id, cursorPosition.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(credentialGroup.createdAt), desc(credentialGroup.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? pageRows.at(-1)?.id : null
  if (hasMore && !nextCursor) throw new Error('Credential group page cursor could not be derived')

  return {
    credentialGroups: pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      providerIds: [
        ...new Set(
          row.options
            .filter((option) => option.status === 'active')
            .map((option) => {
              if (!isCredentialGroupProvider(option.provider)) {
                throw new Error(`Credential Group provider is not registered: ${option.provider}`)
              }
              return getCredentialGroupProviderId(option.provider)
            })
        ),
      ],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: nextCursor ?? null,
  }
}
