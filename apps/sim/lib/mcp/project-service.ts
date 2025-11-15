import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { mcpServerProject } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  CreateMcpServerProjectInput,
  McpServerProject,
  McpServerProjectStatus,
} from '@/lib/mcp/types'
import { normalizeProjectSlug } from '@/lib/mcp/project-slug'

const logger = createLogger('McpProjectService')
const DEFAULT_RUNTIME = 'node'
const DEFAULT_ENTRYPOINT = 'index.ts'

type McpServerProjectRow = typeof mcpServerProject.$inferSelect

export class McpProjectServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpProjectServiceError'
  }
}

async function ensureUniqueSlug(workspaceId: string, slug: string): Promise<string> {
  const baseSlug = normalizeProjectSlug(slug)
  let candidate = baseSlug
  let counter = 1

  while (true) {
    const existing = await db
      .select({ id: mcpServerProject.id })
      .from(mcpServerProject)
      .where(
        and(
          eq(mcpServerProject.workspaceId, workspaceId),
          eq(mcpServerProject.slug, candidate),
          isNull(mcpServerProject.deletedAt)
        )
      )
      .limit(1)

    if (existing.length === 0) {
      return candidate
    }

    counter++
    candidate = `${baseSlug}-${counter}`
  }
}

function mapProject(row: McpServerProjectRow): McpServerProject {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdBy: row.createdBy,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    runtime: row.runtime,
    entryPoint: row.entryPoint,
    template: row.template,
    sourceType: (row.sourceType as McpServerProject['sourceType']) || 'inline',
    repositoryUrl: row.repositoryUrl,
    repositoryBranch: row.repositoryBranch,
    environmentVariables: (row.environmentVariables ?? {}) as Record<string, string>,
    metadata: (row.metadata ?? {}) as Record<string, any>,
    status: row.status as McpServerProjectStatus,
    currentVersionNumber: row.currentVersionNumber,
    lastDeployedVersionId: row.lastDeployedVersionId,
    lastDeployedAt: row.lastDeployedAt?.toISOString(),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

export async function createMcpServerProject(
  input: CreateMcpServerProjectInput
): Promise<McpServerProject> {
  const slugSource = input.slug || input.name
  if (!slugSource) {
    throw new McpProjectServiceError('A project name is required')
  }

  const slug = await ensureUniqueSlug(input.workspaceId, slugSource)
  const environmentVariables = input.environmentVariables ?? {}
  const metadata = input.metadata ?? {}

  const [created] = await db
    .insert(mcpServerProject)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      createdBy: input.createdBy,
      name: input.name,
      slug,
      description: input.description,
      visibility: input.visibility ?? 'workspace',
      runtime: input.runtime || DEFAULT_RUNTIME,
      entryPoint: input.entryPoint || DEFAULT_ENTRYPOINT,
      template: input.template,
      sourceType: input.sourceType ?? 'inline',
      repositoryUrl: input.repositoryUrl,
      repositoryBranch: input.repositoryBranch,
      environmentVariables,
      metadata,
      status: 'draft',
    })
    .returning()

  logger.info('Created MCP server project', {
    projectId: created.id,
    workspaceId: created.workspaceId,
    slug: created.slug,
  })

  return mapProject(created)
}

export async function listMcpServerProjects(workspaceId: string): Promise<McpServerProject[]> {
  const projects = await db
    .select()
    .from(mcpServerProject)
    .where(and(eq(mcpServerProject.workspaceId, workspaceId), isNull(mcpServerProject.deletedAt)))
    .orderBy(desc(mcpServerProject.createdAt))

  return projects.map(mapProject)
}

export async function getMcpServerProject(
  workspaceId: string,
  projectId: string
): Promise<McpServerProject | null> {
  const [project] = await db
    .select()
    .from(mcpServerProject)
    .where(
      and(
        eq(mcpServerProject.workspaceId, workspaceId),
        eq(mcpServerProject.id, projectId),
        isNull(mcpServerProject.deletedAt)
      )
    )
    .limit(1)

  return project ? mapProject(project) : null
}

export interface UpdateMcpServerProjectInput {
  name?: string
  description?: string | null
  visibility?: McpServerProject['visibility']
  runtime?: string
  entryPoint?: string
  template?: string | null
  sourceType?: McpServerProject['sourceType']
  repositoryUrl?: string | null
  repositoryBranch?: string | null
  environmentVariables?: Record<string, string>
  metadata?: Record<string, any>
  status?: McpServerProjectStatus
}

export async function updateMcpServerProject(
  workspaceId: string,
  projectId: string,
  updates: UpdateMcpServerProjectInput
): Promise<McpServerProject> {
  if (Object.keys(updates).length === 0) {
    throw new McpProjectServiceError('No updates provided')
  }

  const [updated] = await db
    .update(mcpServerProject)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpServerProject.workspaceId, workspaceId),
        eq(mcpServerProject.id, projectId),
        isNull(mcpServerProject.deletedAt)
      )
    )
    .returning()

  if (!updated) {
    throw new McpProjectServiceError('Project not found or already deleted')
  }

  return mapProject(updated)
}

export async function archiveMcpServerProject(
  workspaceId: string,
  projectId: string
): Promise<void> {
  const result = await db
    .update(mcpServerProject)
    .set({
      status: 'archived',
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpServerProject.workspaceId, workspaceId),
        eq(mcpServerProject.id, projectId),
        isNull(mcpServerProject.deletedAt)
      )
    )

  if (result.rowCount === 0) {
    throw new McpProjectServiceError('Project not found or already archived')
  }
}
