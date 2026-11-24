/**
 * MCP Pub/Sub Adapter
 *
 * Broadcasts MCP notification events across processes using Redis Pub/Sub. The channels
 * connect on first use, so importing this module opens nothing.
 *
 * Two channels:
 *  - `mcp:tools_changed` — external MCP server sent a listChanged notification
 *    (published by connection manager, consumed by events SSE endpoint)
 *  - `mcp:workflow_tools_changed` — workflow CRUD modified a workflow MCP server's tools
 *    (published by serve route, consumed by serve route on other processes to push to local SSE clients)
 */

import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'
import type { ToolsChangedEvent, WorkflowToolsChangedEvent } from '@/lib/mcp/types'

interface McpPubSubAdapter {
  publishToolsChanged(event: ToolsChangedEvent): void
  publishWorkflowToolsChanged(event: WorkflowToolsChangedEvent): void
  onToolsChanged(handler: (event: ToolsChangedEvent) => void): () => void
  onWorkflowToolsChanged(handler: (event: WorkflowToolsChangedEvent) => void): () => void
  /** Settles once this process receives both channels' events. */
  ready(): Promise<void>
  dispose(): void
}

type McpPubSubGlobal = typeof globalThis & {
  _mcpToolsChannel?: PubSubChannel<ToolsChangedEvent>
  _mcpWorkflowToolsChannel?: PubSubChannel<WorkflowToolsChangedEvent>
}

const g = globalThis as McpPubSubGlobal

g._mcpToolsChannel ??= createPubSubChannel<ToolsChangedEvent>({
  channel: 'mcp:tools_changed',
  label: 'mcp-tools',
})
g._mcpWorkflowToolsChannel ??= createPubSubChannel<WorkflowToolsChangedEvent>({
  channel: 'mcp:workflow_tools_changed',
  label: 'mcp-workflow-tools',
})

const toolsChannel = g._mcpToolsChannel
const workflowToolsChannel = g._mcpWorkflowToolsChannel

export const mcpPubSub: McpPubSubAdapter = {
  publishToolsChanged: (event) => toolsChannel.publish(event),
  publishWorkflowToolsChanged: (event) => workflowToolsChannel.publish(event),
  onToolsChanged: (handler) => toolsChannel.subscribe(handler),
  onWorkflowToolsChanged: (handler) => workflowToolsChannel.subscribe(handler),
  ready: async () => {
    await Promise.all([toolsChannel.ready(), workflowToolsChannel.ready()])
  },
  dispose: () => {
    toolsChannel.dispose()
    workflowToolsChannel.dispose()
  },
}
