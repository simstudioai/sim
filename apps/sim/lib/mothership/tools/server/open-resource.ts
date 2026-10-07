import {
  type OpenResourceInput,
  type OpenResourceOutput,
  openResourceInputSchema,
  openResourceOutputSchema,
} from '@/lib/api/contracts/mothership-resource-tools'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkspaceDashboard } from '@/lib/dashboards/application/dashboards'
import { readKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { logDelegationPolicy } from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { readLogDetailUseCase } from '@/lib/logs/application/read-log-detail'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { executeDashboardUseCase } from '@/lib/mothership/application/execute-dashboard-use-case'
import { executeCopilotKnowledgeUseCase } from '@/lib/mothership/application/execute-knowledge-use-case'
import { executeCopilotTableUseCase } from '@/lib/mothership/application/execute-table-use-case'
import { executeCopilotWorkflowUseCase } from '@/lib/mothership/application/execute-workflow-use-case'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  requireTrustedCopilotExecutionContext,
} from '@/lib/mothership/auth/application-delegation'
import { getCopilotFileOwnerAdapter } from '@/lib/mothership/file-owners'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
} from '@/lib/mothership/tools/server/base-tool'
import { readTableDefinitionUseCase } from '@/lib/table/application/tables'
import { readTableViewUseCase } from '@/lib/table/application/views'
import { readWorkflowMetadata } from '@/lib/workflows/application/read-workflow'

const executeLogUseCase = createCopilotApplicationAdapter({
  domain: 'logs',
  operations: logOperations,
  delegation: {
    audience: logDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
})

/** A successful batch publishes only canonical resources after every read has authorized. */
export const openResourceServerTool: BaseServerTool<OpenResourceInput, OpenResourceOutput> = {
  name: 'open_resource',
  inputSchema: openResourceInputSchema,
  outputSchema: openResourceOutputSchema,
  async execute(input, context) {
    if (context?.requestMode !== 'agent' && context?.requestMode !== 'plan')
      throw new OrchestrationError('forbidden', 'Resource panels require agent mode')
    if (
      input.resources.some(
        (resource) =>
          resource.owner && getCopilotFileOwnerAdapter(resource.owner).resourceScope === 'owner'
      )
    ) {
      if (
        input.workspaceId ||
        input.resources.some(
          (resource) =>
            resource.type !== 'file' ||
            !resource.owner ||
            getCopilotFileOwnerAdapter(resource.owner).resourceScope !== 'owner' ||
            resource.viewId
        )
      )
        throw new OrchestrationError(
          'validation',
          'Owner-scoped files cannot be mixed with workspace targets'
        )
      const resources: OpenResourceOutput['resources'] = []
      for (const resource of input.resources) {
        assertServerToolNotAborted(context)
        if (!resource.owner) throw new OrchestrationError('validation', 'File owner required')
        const file = await getCopilotFileOwnerAdapter(resource.owner).readMetadata(context, {
          owner: resource.owner,
          fileId: resource.id,
        })
        resources.push({ type: 'file', id: file.id, title: file.name, owner: file.owner })
      }
      assertServerToolNotAborted(context)
      return { resources }
    }
    const trusted = requireTrustedCopilotExecutionContext(context)
    if (input.workspaceId && input.workspaceId !== trusted.workspaceId)
      throw new OrchestrationError('not_found', 'Workspace not found in this invocation')
    const workspaceId = trusted.workspaceId
    const resources: OpenResourceOutput['resources'] = []
    for (const resource of input.resources) {
      assertServerToolNotAborted(context)
      if (
        resource.owner &&
        (resource.type !== 'file' ||
          getCopilotFileOwnerAdapter(resource.owner).resourceScope !== 'workspace' ||
          resource.owner.entityId !== workspaceId)
      )
        throw new OrchestrationError('not_found', 'File owner not found in this invocation')
      if (resource.viewId && resource.type !== 'table')
        throw new OrchestrationError('validation', 'Saved views apply only to tables')
      const base = { type: resource.type, id: resource.id }
      switch (resource.type) {
        case 'workflow': {
          const { workflow } = await executeCopilotWorkflowUseCase(context, readWorkflowMetadata, {
            workflowId: resource.id,
            assertedWorkspaceId: workspaceId,
          })
          resources.push({ ...base, title: workflow.name })
          break
        }
        case 'table': {
          const { table } = await executeCopilotTableUseCase(
            context,
            readTableDefinitionUseCase,
            { tableId: resource.id, workspaceId },
            { tableId: resource.id }
          )
          if (resource.viewId)
            await executeCopilotTableUseCase(
              context,
              readTableViewUseCase,
              { tableId: resource.id, workspaceId, viewId: resource.viewId },
              { tableId: resource.id }
            )
          resources.push({
            ...base,
            title: table.name,
            ...(resource.viewId ? { viewId: resource.viewId } : {}),
          })
          break
        }
        case 'dashboard': {
          const { dashboard } = await executeDashboardUseCase(context, readWorkspaceDashboard, {
            workspaceId,
          })
          if (dashboard?.id !== resource.id)
            throw new OrchestrationError('not_found', 'Dashboard not found')
          resources.push({ ...base, title: dashboard.name })
          break
        }
        case 'file': {
          const owner = resource.owner ?? {
            entityType: 'workspace' as const,
            entityId: workspaceId,
          }
          const file = await getCopilotFileOwnerAdapter(owner).readMetadata(context, {
            owner,
            fileId: resource.id,
          })
          resources.push({
            ...base,
            title: file.name,
            ...(resource.owner ? { owner: file.owner } : {}),
          })
          break
        }
        case 'knowledgebase': {
          const { knowledgeBase } = await executeCopilotKnowledgeUseCase(
            context,
            readKnowledgeBase,
            { knowledgeBaseId: resource.id, assertedWorkspaceId: workspaceId }
          )
          resources.push({ ...base, title: knowledgeBase.name })
          break
        }
        case 'log': {
          const { detail } = await executeLogUseCase(context, readLogDetailUseCase, {
            workspaceId,
            lookupColumn: 'id',
            lookupValue: resource.id,
          })
          resources.push({
            ...base,
            title: 'Workflow run',
            ...(detail.executionId ? { executionId: detail.executionId } : {}),
          })
          break
        }
      }
    }
    assertServerToolNotAborted(context)
    return { resources }
  },
}
