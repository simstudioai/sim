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

import { createPubSubChannel } from '@/lib/events/pubsub'
import type { ToolsChangedEvent, WorkflowToolsChangedEvent } from '@/lib/mcp/types'

interface McpPubSubAdapter {
  publishToolsChanged(event: ToolsChangedEvent): void
  publishWorkflowToolsChanged(event: WorkflowToolsChangedEvent): void
  onToolsChanged(handler: (event: ToolsChangedEvent) => void): () => void
  onWorkflowToolsChanged(handler: (event: WorkflowToolsChangedEvent) => void): () => void
  dispose(): void
}

const toolsChannel =
  typeof window !== 'undefined'
    ? null
    : createPubSubChannel<ToolsChangedEvent>({
        channel: 'mcp:tools_changed',
        label: 'mcp-tools',
      })

const workflowToolsChannel =
  typeof window !== 'undefined'
    ? null
    : createPubSubChannel<WorkflowToolsChangedEvent>({
        channel: 'mcp:workflow_tools_changed',
        label: 'mcp-workflow-tools',
      })

export const mcpPubSub: McpPubSubAdapter =
  typeof window !== 'undefined' || !toolsChannel || !workflowToolsChannel
    ? (null as unknown as McpPubSubAdapter)
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
