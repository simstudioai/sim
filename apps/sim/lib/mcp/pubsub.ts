/**
 * MCP Pub/Sub Adapter
 *
 * Broadcasts MCP notification events across processes using Redis Pub/Sub.
 * Gracefully falls back to process-local EventEmitter when Redis is unavailable.
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
  dispose(): void
}

type McpPubSubGlobal = typeof globalThis & {
  _mcpToolsChannel?: PubSubChannel<ToolsChangedEvent> | null
  _mcpWorkflowToolsChannel?: PubSubChannel<WorkflowToolsChangedEvent> | null
}

const g = globalThis as McpPubSubGlobal

if (!('_mcpToolsChannel' in g)) {
  g._mcpToolsChannel =
    typeof window !== 'undefined'
      ? null
      : createPubSubChannel<ToolsChangedEvent>({
          channel: 'mcp:tools_changed',
          label: 'mcp-tools',
        })
}

if (!('_mcpWorkflowToolsChannel' in g)) {
  g._mcpWorkflowToolsChannel =
    typeof window !== 'undefined'
      ? null
      : createPubSubChannel<WorkflowToolsChangedEvent>({
          channel: 'mcp:workflow_tools_changed',
          label: 'mcp-workflow-tools',
        })
}

const toolsChannel = g._mcpToolsChannel
const workflowToolsChannel = g._mcpWorkflowToolsChannel

export const mcpPubSub: McpPubSubAdapter | null =
  typeof window !== 'undefined' || !toolsChannel || !workflowToolsChannel
    ? null
    : {
        publishToolsChanged: (event) => toolsChannel.publish(event),
        publishWorkflowToolsChanged: (event) => workflowToolsChannel.publish(event),
        onToolsChanged: (handler) => toolsChannel.subscribe(handler),
        onWorkflowToolsChanged: (handler) => workflowToolsChannel.subscribe(handler),
        dispose: () => {
          toolsChannel.dispose()
          workflowToolsChannel.dispose()
        },
      }
