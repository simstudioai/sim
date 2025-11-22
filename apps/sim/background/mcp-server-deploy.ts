import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import {
  mcpServerDeployment,
  mcpServerProject,
  mcpServers,
  mcpServerVersion,
} from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { activateHostedDeployment, buildHostedBundle } from '@/lib/mcp/hosted-orchestrator'
import { mcpService } from '@/lib/mcp/service'

const logger = createLogger('McpServerDeployTask')

export type McpServerDeployPayload = {
  deploymentId: string
  projectId: string
  versionId: string
  workspaceId: string
  userId: string
}

async function loadDeploymentContext(payload: McpServerDeployPayload) {
  const [project] = await db
    .select()
    .from(mcpServerProject)
    .where(eq(mcpServerProject.id, payload.projectId))
    .limit(1)

  if (!project) {
    throw new Error(`MCP project ${payload.projectId} not found`)
  }

  const [version] = await db
    .select()
    .from(mcpServerVersion)
    .where(and(eq(mcpServerVersion.id, payload.versionId), eq(mcpServerVersion.projectId, project.id)))
    .limit(1)

  if (!version) {
    throw new Error(`MCP version ${payload.versionId} not found for project ${project.id}`)
  }

  const [deployment] = await db
    .select()
    .from(mcpServerDeployment)
    .where(
      and(
        eq(mcpServerDeployment.id, payload.deploymentId),
        eq(mcpServerDeployment.projectId, project.id)
      )
    )
    .limit(1)

  if (!deployment) {
    throw new Error(`Deployment ${payload.deploymentId} not found for project ${project.id}`)
  }

  return { project, version, deployment }
}

async function upsertHostedServer(
  project: typeof mcpServerProject.$inferSelect,
  deploymentId: string,
  currentServerId: string | null,
  endpointUrl: string,
  userId: string
): Promise<string> {
  if (currentServerId) {
    await db
      .update(mcpServers)
      .set({
        url: endpointUrl,
        projectId: project.id,
        connectionStatus: 'connected',
        lastConnected: new Date(),
        lastUsed: new Date(),
        kind: 'hosted',
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, currentServerId))

    return currentServerId
  }

  const [server] = await db
    .insert(mcpServers)
    .values({
      id: randomUUID(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      createdBy: userId,
      name: `${project.name} (Hosted)`,
      description: project.description,
      transport: 'http',
      url: endpointUrl,
      headers: {},
      timeout: 30000,
      retries: 3,
      enabled: true,
      connectionStatus: 'connected',
      kind: 'hosted',
      lastConnected: new Date(),
    })
    .returning({ id: mcpServers.id })

  logger.info(`Created hosted MCP server ${server.id} for project ${project.id}`, { deploymentId })
  return server.id
}

async function runDeployment(payload: McpServerDeployPayload) {
  const { project, version, deployment } = await loadDeploymentContext(payload)

  await db
    .update(mcpServerVersion)
    .set({ status: 'building', updatedAt: new Date() })
    .where(eq(mcpServerVersion.id, version.id))

  await db
    .update(mcpServerDeployment)
    .set({ status: 'deploying', updatedAt: new Date() })
    .where(eq(mcpServerDeployment.id, deployment.id))

  try {
    const buildResult = await buildHostedBundle(project, version)
    const activation = await activateHostedDeployment(deployment.id)

    await db
      .update(mcpServerVersion)
      .set({
        status: 'ready',
        artifactUrl: buildResult.artifactUrl,
        runtimeMetadata: buildResult.runtimeMetadata,
        buildLogsUrl: buildResult.logsUrl,
        updatedAt: new Date(),
      })
      .where(eq(mcpServerVersion.id, version.id))

    const serverId = await upsertHostedServer(
      project,
      deployment.id,
      deployment.serverId,
      activation.endpointUrl,
      payload.userId
    )

    await db
      .update(mcpServerDeployment)
      .set({
        status: 'active',
        endpointUrl: activation.endpointUrl,
        logsUrl: activation.logsUrl,
        serverId,
        deployedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mcpServerDeployment.id, deployment.id))

    mcpService.clearCache(project.workspaceId)
    logger.info(`Hosted MCP deployment ${deployment.id} activated`, {
      projectId: project.id,
      serverId,
    })

    return { deploymentId: deployment.id, serverId }
  } catch (error) {
    logger.error(`Hosted MCP deployment ${deployment.id} failed`, error)

    const errorMessage =
      error instanceof Error ? error.message : 'Deployment failed unexpectedly'

    await db
      .update(mcpServerVersion)
      .set({
        status: 'failed',
        runtimeMetadata: {
          ...((version.runtimeMetadata as Record<string, any>) ?? {}),
          lastError: errorMessage,
        },
        updatedAt: new Date(),
      })
      .where(eq(mcpServerVersion.id, version.id))

    await db
      .update(mcpServerDeployment)
      .set({
        status: 'failed',
        logsUrl: deployment.logsUrl ?? null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServerDeployment.id, deployment.id))

    throw error
  }
}

export const mcpServerDeploy = task({
  id: 'mcp-server-deploy',
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: McpServerDeployPayload) => runDeployment(payload),
})
