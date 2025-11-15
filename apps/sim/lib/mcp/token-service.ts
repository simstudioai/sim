import { createHash, randomBytes, randomUUID } from 'crypto'
import { db } from '@sim/db'
import { mcpServerProject, mcpServerToken } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpServerToken, McpServerTokenScope } from '@/lib/mcp/types'

const logger = createLogger('McpTokenService')

type TokenRow = typeof mcpServerToken.$inferSelect

function mapToken(row: TokenRow): McpServerToken {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    scope: row.scope as McpServerTokenScope,
    lastUsedAt: row.lastUsedAt?.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

async function assertProject(workspaceId: string, projectId: string) {
  const [project] = await db
    .select({ id: mcpServerProject.id })
    .from(mcpServerProject)
    .where(
      and(
        eq(mcpServerProject.id, projectId),
        eq(mcpServerProject.workspaceId, workspaceId),
        isNull(mcpServerProject.deletedAt)
      )
    )
    .limit(1)

  if (!project) {
    throw new Error('Project not found or access denied')
  }
}

export async function listMcpServerTokens(
  workspaceId: string,
  projectId: string
): Promise<McpServerToken[]> {
  await assertProject(workspaceId, projectId)

  const tokens = await db
    .select()
    .from(mcpServerToken)
    .where(eq(mcpServerToken.projectId, projectId))
    .orderBy(desc(mcpServerToken.createdAt))

  return tokens.map(mapToken)
}

function generateTokenValue(): string {
  return `mcpts_${randomBytes(24).toString('hex')}`
}

interface IssueTokenInput {
  workspaceId: string
  projectId: string
  name: string
  scope?: McpServerTokenScope
  expiresAt?: Date
  createdBy?: string | null
}

export async function issueMcpServerToken(
  input: IssueTokenInput
): Promise<{ token: string; record: McpServerToken }> {
  await assertProject(input.workspaceId, input.projectId)
  const tokenValue = generateTokenValue()
  const hashedToken = createHash('sha256').update(tokenValue).digest('hex')

  const [record] = await db
    .insert(mcpServerToken)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      hashedToken,
      scope: input.scope ?? 'runtime',
      createdBy: input.createdBy ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning()

  logger.info('Issued MCP server token', {
    projectId: input.projectId,
    tokenId: record.id,
    scope: record.scope,
  })

  return {
    token: tokenValue,
    record: mapToken(record),
  }
}

export async function revokeMcpServerToken(
  workspaceId: string,
  projectId: string,
  tokenId: string
): Promise<void> {
  await assertProject(workspaceId, projectId)

  const { rowCount } = await db
    .delete(mcpServerToken)
    .where(and(eq(mcpServerToken.projectId, projectId), eq(mcpServerToken.id, tokenId)))

  if (rowCount === 0) {
    throw new Error('Token not found or already revoked')
  }
}
