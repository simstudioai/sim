import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { mcpServerProject, mcpServerVersion } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  McpServerVersion,
  McpServerVersionStatus,
  McpServerProject,
} from '@/lib/mcp/types'

const logger = createLogger('McpVersionService')

type McpServerVersionRow = typeof mcpServerVersion.$inferSelect

function mapVersion(row: McpServerVersionRow): McpServerVersion {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    sourceHash: row.sourceHash ?? undefined,
    manifest: (row.manifest ?? {}) as Record<string, any>,
    buildConfig: (row.buildConfig ?? {}) as Record<string, any>,
    artifactUrl: row.artifactUrl ?? undefined,
    runtimeMetadata: (row.runtimeMetadata ?? {}) as Record<string, any>,
    status: row.status as McpServerVersionStatus,
    buildLogsUrl: row.buildLogsUrl ?? undefined,
    changelog: row.changelog ?? undefined,
    promotedBy: row.promotedBy ?? undefined,
    promotedAt: row.promotedAt?.toISOString(),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

async function assertProjectAccess(
  workspaceId: string,
  projectId: string
): Promise<Pick<McpServerProject, 'id' | 'workspaceId'> & { currentVersionNumber?: number | null }> {
  const [project] = await db
    .select({
      id: mcpServerProject.id,
      workspaceId: mcpServerProject.workspaceId,
      currentVersionNumber: mcpServerProject.currentVersionNumber,
    })
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

  return project
}

export async function listMcpServerVersions(
  workspaceId: string,
  projectId: string
): Promise<McpServerVersion[]> {
  await assertProjectAccess(workspaceId, projectId)

  const versions = await db
    .select()
    .from(mcpServerVersion)
    .where(eq(mcpServerVersion.projectId, projectId))
    .orderBy(desc(mcpServerVersion.versionNumber))

  return versions.map(mapVersion)
}

interface CreateVersionInput {
  workspaceId: string
  projectId: string
  sourceHash?: string
  manifest?: Record<string, any>
  buildConfig?: Record<string, any>
  artifactUrl?: string
  runtimeMetadata?: Record<string, any>
  changelog?: string
  buildLogsUrl?: string
}

export async function createMcpServerVersion(
  input: CreateVersionInput
): Promise<McpServerVersion> {
  const project = await assertProjectAccess(input.workspaceId, input.projectId)
  const nextVersionNumber = (project.currentVersionNumber ?? 0) + 1

  const [version] = await db
    .insert(mcpServerVersion)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      versionNumber: nextVersionNumber,
      sourceHash: input.sourceHash,
      manifest: input.manifest ?? {},
      buildConfig: input.buildConfig ?? {},
      artifactUrl: input.artifactUrl,
      runtimeMetadata: input.runtimeMetadata ?? {},
      changelog: input.changelog,
      buildLogsUrl: input.buildLogsUrl,
    })
    .returning()

  await db
    .update(mcpServerProject)
    .set({
      currentVersionNumber: nextVersionNumber,
      updatedAt: new Date(),
    })
    .where(eq(mcpServerProject.id, input.projectId))

  logger.info('Created MCP server version', {
    projectId: input.projectId,
    versionId: version.id,
    versionNumber: version.versionNumber,
  })

  return mapVersion(version)
}

interface UpdateVersionInput {
  status?: McpServerVersionStatus
  artifactUrl?: string | null
  runtimeMetadata?: Record<string, any>
  buildLogsUrl?: string | null
  changelog?: string | null
  promotedBy?: string | null
  promotedAt?: Date | null
}

export async function updateMcpServerVersion(
  workspaceId: string,
  projectId: string,
  versionId: string,
  updates: UpdateVersionInput
): Promise<McpServerVersion> {
  await assertProjectAccess(workspaceId, projectId)

  const [updated] = await db
    .update(mcpServerVersion)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(and(eq(mcpServerVersion.id, versionId), eq(mcpServerVersion.projectId, projectId)))
    .returning()

  if (!updated) {
    throw new Error('Version not found or access denied')
  }

  return mapVersion(updated)
}

export async function getMcpServerVersion(
  workspaceId: string,
  projectId: string,
  versionId: string
): Promise<McpServerVersion | null> {
  await assertProjectAccess(workspaceId, projectId)

  const [version] = await db
    .select()
    .from(mcpServerVersion)
    .where(and(eq(mcpServerVersion.projectId, projectId), eq(mcpServerVersion.id, versionId)))
    .limit(1)

  return version ? mapVersion(version) : null
}
