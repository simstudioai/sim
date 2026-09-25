import type { DashboardRecord } from '@/lib/api/contracts/dashboards'
import {
  mothershipDashboardFoldersInputSchema,
  mothershipDashboardsInputSchema,
} from '@/lib/api/contracts/mothership-dashboards'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createDashboard,
  deleteDashboard,
  listDashboards,
  moveDashboard,
  readDashboard,
  updateDashboard,
} from '@/lib/dashboards/application/dashboards'
import {
  createDashboardFolder,
  deleteDashboardFolder,
  listDashboardFolders,
  moveDashboardFolder,
} from '@/lib/dashboards/application/folders'
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

function dashboardEffect(workspaceId: string, dashboard: DashboardRecord): ResourceChange[] {
  return [
    {
      op: 'upsert',
      resource: { type: 'dashboard', workspaceId, id: dashboard.id, title: dashboard.name },
    },
  ]
}

export const dashboardsServerTool: BaseServerTool = {
  name: 'dashboards',
  inputSchema: mothershipDashboardsInputSchema,
  async execute(raw, context) {
    const input = mothershipDashboardsInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'list':
        return executeDashboardUseCase(context, listDashboards, {
          workspaceId,
          search: input.search,
        })
      case 'get':
        return executeDashboardUseCase(context, readDashboard, {
          workspaceId,
          dashboardId: input.dashboardId,
        })
      case 'create': {
        const result = await executeDashboardUseCase(context, createDashboard, {
          ...input,
          workspaceId,
        })
        return { ...result, resources: dashboardEffect(workspaceId, result.dashboard) }
      }
      case 'update': {
        const result = await executeDashboardUseCase(context, updateDashboard, {
          ...input,
          workspaceId,
        })
        return { ...result, resources: dashboardEffect(workspaceId, result.dashboard) }
      }
      case 'move': {
        const result = await executeDashboardUseCase(context, moveDashboard, {
          ...input,
          workspaceId,
        })
        return { ...result, resources: dashboardEffect(workspaceId, result.dashboard) }
      }
      case 'delete': {
        const result = await executeDashboardUseCase(context, deleteDashboard, {
          workspaceId,
          dashboardId: input.dashboardId,
        })
        const resources: ResourceChange[] = [
          { op: 'remove', resource: { type: 'dashboard', workspaceId, id: result.id } },
        ]
        return { ...result, resources }
      }
    }
  },
}

export const dashboardFoldersServerTool: BaseServerTool = {
  name: 'dashboard_folders',
  inputSchema: mothershipDashboardFoldersInputSchema,
  async execute(raw, context) {
    const input = mothershipDashboardFoldersInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'list':
        return executeDashboardUseCase(context, listDashboardFolders, { workspaceId })
      case 'create':
        return executeDashboardUseCase(context, createDashboardFolder, {
          workspaceId,
          path: input.path,
        })
      case 'move':
        return executeDashboardUseCase(context, moveDashboardFolder, {
          workspaceId,
          path: input.path,
          destinationPath: input.destinationPath,
        })
      case 'delete':
        return executeDashboardUseCase(context, deleteDashboardFolder, {
          workspaceId,
          path: input.path,
        })
    }
  },
}
