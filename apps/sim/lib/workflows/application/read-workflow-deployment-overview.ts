import type { Principal } from '@sim/auth/principal'
import { chat, db, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { getWorkflowDeploymentSummary } from '@/lib/workflows/orchestration'

export const MAX_WORKFLOW_MCP_STATUS_TOOLS = 100
export const MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES = 64 * 1024
export const MAX_WORKFLOW_MCP_STATUS_TOTAL_SCHEMA_BYTES = 1024 * 1024

export interface ReadWorkflowDeploymentOverviewInput {
  workflowId: string
  assertedWorkspaceId?: string
}

function resolveWorkflowContext({
  principal,
  input,
}: {
  principal: Principal
  input: ReadWorkflowDeploymentOverviewInput
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

export const readWorkflowDeploymentOverview = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readDeploymentOverview,
  resolveContext: resolveWorkflowContext,
  async execute({ context }) {
    const [deploymentSummary, chatDeploy, mcpRows] = await Promise.all([
      getWorkflowDeploymentSummary(context.workflowId),
      db
        .select({
          id: chat.id,
          identifier: chat.identifier,
          title: chat.title,
          description: chat.description,
          authType: chat.authType,
          allowedEmails: chat.allowedEmails,
          outputConfigs: chat.outputConfigs,
          includeThinking: chat.includeThinking,
          includeToolCalls: chat.includeToolCalls,
          password: chat.password,
          customizations: chat.customizations,
        })
        .from(chat)
        .where(and(eq(chat.workflowId, context.workflowId), isNull(chat.archivedAt)))
        .limit(1),
      db
        .select({
          serverId: workflowMcpServer.id,
          serverName: workflowMcpServer.name,
          toolName: workflowMcpTool.toolName,
          toolDescription: workflowMcpTool.toolDescription,
          parameterSchema: sql<unknown>`CASE
            WHEN COALESCE(octet_length(${workflowMcpTool.parameterSchema}::text), 0)
              <= ${MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES}
            THEN ${workflowMcpTool.parameterSchema}
            ELSE NULL
          END`,
          parameterSchemaBytes:
            sql<number>`COALESCE(octet_length(${workflowMcpTool.parameterSchema}::text), 0)`.mapWith(
              Number
            ),
          toolId: workflowMcpTool.id,
        })
        .from(workflowMcpTool)
        .innerJoin(workflowMcpServer, eq(workflowMcpTool.serverId, workflowMcpServer.id))
        .where(
          and(
            eq(workflowMcpTool.workflowId, context.workflowId),
            isNull(workflowMcpTool.archivedAt),
            isNull(workflowMcpServer.deletedAt)
          )
        )
        .orderBy(asc(workflowMcpServer.id), asc(workflowMcpTool.toolName))
        .limit(MAX_WORKFLOW_MCP_STATUS_TOOLS + 1),
    ])

    const isDeployed = deploymentSummary.activeDeployment !== null
    const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
    const needsRedeployment =
      isDeployed && attemptStatus !== 'preparing' && attemptStatus !== 'activating'
        ? await checkNeedsRedeployment(context.workflowId)
        : false
    let schemaBytes = 0
    let mcpToolsTruncated = mcpRows.length > MAX_WORKFLOW_MCP_STATUS_TOOLS
    const mcpTools = []
    for (const row of mcpRows.slice(0, MAX_WORKFLOW_MCP_STATUS_TOOLS)) {
      if (!Number.isFinite(row.parameterSchemaBytes) || row.parameterSchemaBytes < 0) {
        throw new Error('Workflow MCP status query returned an invalid schema byte count')
      }
      const schemaOversized = row.parameterSchemaBytes > MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES
      if (
        !schemaOversized &&
        schemaBytes + row.parameterSchemaBytes > MAX_WORKFLOW_MCP_STATUS_TOTAL_SCHEMA_BYTES
      ) {
        mcpToolsTruncated = true
        break
      }
      if (!schemaOversized) schemaBytes += row.parameterSchemaBytes
      if (schemaOversized) mcpToolsTruncated = true
      const { parameterSchemaBytes: _parameterSchemaBytes, ...tool } = row
      mcpTools.push({
        ...tool,
        parameterSchema: schemaOversized
          ? { truncated: true, bytes: row.parameterSchemaBytes }
          : row.parameterSchema,
      })
    }

    return {
      workflow: context.workflow,
      workspaceId: context.workspaceId,
      isDeployed,
      needsRedeployment,
      ...deploymentSummary,
      chatDeployment: chatDeploy[0] ?? null,
      mcpTools,
      mcpToolsTruncated,
    }
  },
})
