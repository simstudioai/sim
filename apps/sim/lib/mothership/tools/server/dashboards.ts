import { mothershipDashboardsInputSchema } from '@/lib/api/contracts/mothership-dashboards'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  readWorkspaceDashboard,
  saveWorkspaceDashboard,
} from '@/lib/dashboards/application/dashboards'
import { executeDashboardUseCase } from '@/lib/mothership/application/execute-dashboard-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'

function workspaceFor(input: { workspaceId?: string }, context?: ServerToolContext): string {
  const trusted = requireTrustedCopilotExecutionContext(context)
  if (input.workspaceId && input.workspaceId !== trusted.workspaceId)
    throw new OrchestrationError('not_found', 'Workspace not found in this invocation')
  assertServerToolNotAborted(context)
  return trusted.workspaceId
}

export const dashboardsServerTool: BaseServerTool = {
  name: 'dashboards',
  inputSchema: mothershipDashboardsInputSchema,
  async execute(raw, context) {
    const input = mothershipDashboardsInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'get':
        return executeDashboardUseCase(context, readWorkspaceDashboard, { workspaceId })
      case 'set': {
        const result = await executeDashboardUseCase(context, saveWorkspaceDashboard, {
          workspaceId,
          content: input.content,
          expectedRevision: input.expectedRevision,
        })
        const resources: ResourceChange[] = [
          {
            op: 'upsert',
            resource: {
              type: 'dashboard',
              workspaceId,
              id: result.dashboard.id,
              title: result.dashboard.name,
            },
          },
        ]
        return { ...result, resources }
      }
    }
  },
}
