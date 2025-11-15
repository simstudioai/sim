import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import {
  mcpServerDeployment,
  mcpServerProject,
  mcpServerVersion,
  mcpServers,
} from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  McpServerDeployment,
  McpServerDeploymentStatus,
  McpServerProject,
} from '@/lib/mcp/types'

const logger = createLogger('McpDeploymentService')

type DeploymentRow = typeof mcpServerDeployment.$inferSelect

function mapDeployment(row: DeploymentRow): McpServerDeployment {
  return {
    id: row.id,
    projectId: row.projectId,
    versionId: row.versionId ?? undefined,
    serverId: row.serverId ?? undefined,
    workspaceId: row.workspaceId,
    environment: row.environment,
    region: row.region ?? undefined,
    endpointUrl: row.endpointUrl ?? undefined,
    status: row.status as McpServerDeploymentStatus,
    logsUrl: row.logsUrl ?? undefined,
    deployedBy: row.deployedBy ?? undefined,
    deployedAt: row.deployedAt?.toISOString(),
    rolledBackAt: row.rolledBackAt?.toISOString(),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

async function assertProject(
  workspaceId: string,
  projectId: string
): Promise<Pick<McpServerProject, 'id' | 'workspaceId'>> {
  const [project] = await db
    .select({ id: mcpServerProject.id, workspaceId: mcpServerProject.workspaceId })
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

async function assertVersion(projectId: string, versionId: string) {
  const [version] = await db
    .select({ id: mcpServerVersion.id })
    .from(mcpServerVersion)
    .where(and(eq(mcpServerVersion.id, versionId), eq(mcpServerVersion.projectId, projectId)))
    .limit(1)

  if (!version) {
    throw new Error('Version not found or does not belong to project')
  }
}

async function assertServer(workspaceId: string, serverId: string) {
  const [server] = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(
      and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt))
    )
    .limit(1)

  if (!server) {
    throw new Error('Server not found or access denied')
  }
}

export async function listMcpServerDeployments(
  workspaceId: string,
  projectId: string
): Promise<McpServerDeployment[]> {
  await assertProject(workspaceId, projectId)
  const deployments = await db
    .select()
    .from(mcpServerDeployment)
    .where(eq(mcpServerDeployment.projectId, projectId))
    .orderBy(desc(mcpServerDeployment.createdAt))

  return deployments.map(mapDeployment)
}

interface CreateDeploymentInput {
  workspaceId: string
  projectId: string
  versionId: string
  environment?: string
  region?: string
  serverId?: string
  deployedBy?: string
}

export async function createMcpServerDeployment(
  input: CreateDeploymentInput
): Promise<McpServerDeployment> {
  const project = await assertProject(input.workspaceId, input.projectId)
  await assertVersion(project.id, input.versionId)

  if (input.serverId) {
    await assertServer(project.workspaceId, input.serverId)
  }

  const [deployment] = await db
    .insert(mcpServerDeployment)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      versionId: input.versionId,
      serverId: input.serverId ?? null,
      workspaceId: project.workspaceId,
      environment: input.environment ?? 'production',
      region: input.region ?? null,
      status: 'pending',
      deployedBy: input.deployedBy ?? null,
    })
    .returning()

  logger.info('Created MCP server deployment', {
    projectId: input.projectId,
    deploymentId: deployment.id,
  })

  return mapDeployment(deployment)
}

interface UpdateDeploymentInput {
  status?: McpServerDeploymentStatus
  endpointUrl?: string | null
  logsUrl?: string | null
  serverId?: string | null
  rolledBackAt?: Date | null
}

export async function updateMcpServerDeployment(
  workspaceId: string,
  projectId: string,
  deploymentId: string,
  updates: UpdateDeploymentInput
): Promise<McpServerDeployment> {
  const project = await assertProject(workspaceId, projectId)

  if (updates.serverId) {
    await assertServer(project.workspaceId, updates.serverId)
  }

  const [deployment] = await db
    .update(mcpServerDeployment)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpServerDeployment.id, deploymentId),
        eq(mcpServerDeployment.projectId, projectId)
      )
    )
    .returning()

  if (!deployment) {
    throw new Error('Deployment not found or access denied')
  }

  return mapDeployment(deployment)
}

export async function getMcpServerDeployment(
  workspaceId: string,
  projectId: string,
  deploymentId: string
): Promise<McpServerDeployment | null> {
  await assertProject(workspaceId, projectId)

  const [deployment] = await db
    .select()
    .from(mcpServerDeployment)
    .where(
      and(
        eq(mcpServerDeployment.projectId, projectId),
        eq(mcpServerDeployment.id, deploymentId)
      )
    )
    .limit(1)

  return deployment ? mapDeployment(deployment) : null
}
