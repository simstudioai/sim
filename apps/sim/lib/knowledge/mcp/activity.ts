import { db } from '@sim/db'
import { oauthClient, organizationSearchMcpInvocation } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'

const logger = createLogger('OrganizationSearchMcpActivity')

export type SearchMcpActivityInput = Pick<
  typeof organizationSearchMcpInvocation.$inferInsert,
  | 'organizationId'
  | 'userId'
  | 'authKind'
  | 'oauthClientId'
  | 'toolName'
  | 'outcome'
  | 'durationMs'
  | 'createdAt'
>

/** Stores content-free metadata from an admitted MCP request, independently of tool success. */
export async function recordOrganizationSearchMcpActivity(
  input: SearchMcpActivityInput
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`)
      await tx.insert(organizationSearchMcpInvocation).values({
        id: generateId(),
        organizationId: input.organizationId,
        userId: input.userId,
        authKind: input.authKind,
        oauthClientId: input.oauthClientId,
        clientName: input.oauthClientId
          ? sql`(SELECT left(${oauthClient.name}, 256) FROM ${oauthClient} WHERE ${oauthClient.clientId} = ${input.oauthClientId})`
          : null,
        toolName: input.toolName,
        outcome: input.outcome,
        durationMs: input.durationMs,
        createdAt: input.createdAt,
      })
    })
  } catch (error) {
    logger.warn('Failed to record organization Search MCP activity', {
      error: getErrorMessage(error),
    })
  }
}
