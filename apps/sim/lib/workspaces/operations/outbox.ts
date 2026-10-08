import { z } from 'zod'
import { deferOutboxHandler, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { publishMcpToolServerChanges } from '@/lib/mcp/workflow-mcp-sync'
import { notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import {
  WORKSPACE_MCP_CHANGED_EVENT,
  WORKSPACE_OPERATION_OBSERVE_EVENT,
  WORKSPACE_WORKFLOWS_CHANGED_EVENT,
} from '@/lib/workspaces/operations/outbox-events'
import { refreshWorkspaceOperation } from '@/lib/workspaces/operations/refresh'

const operationSchema = z
  .object({ workspaceId: z.string().min(1).max(256), operationId: z.string().min(1).max(256) })
  .strict()
const changedWorkspaceSchema = z.object({ workspaceId: z.string().min(1).max(256) }).strict()

const serverChangesSchema = z
  .object({ serverIds: z.array(z.string().min(1).max(256)).max(2000) })
  .strict()

export const workspaceOperationOutboxHandlers = {
  [WORKSPACE_MCP_CHANGED_EVENT]: async (payload) => {
    await publishMcpToolServerChanges(serverChangesSchema.parse(payload).serverIds)
  },
  [WORKSPACE_OPERATION_OBSERVE_EVENT]: async (payload) => {
    const { workspaceId, operationId } = operationSchema.parse(payload)
    const report = await refreshWorkspaceOperation(workspaceId, operationId)
    if (report && !report.completionRecorded)
      return deferOutboxHandler('Waiting for workspace operation effects', 5000, false)
  },
  [WORKSPACE_WORKFLOWS_CHANGED_EVENT]: async (payload) => {
    const { workspaceId } = changedWorkspaceSchema.parse(payload)
    await notifyWorkspaceWorkflowsChanged(workspaceId)
  },
} satisfies OutboxHandlerRegistry
