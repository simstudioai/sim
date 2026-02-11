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

import { EventEmitter } from 'events'
import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { env } from '@/lib/core/config/env'
import type { ToolsChangedEvent, WorkflowToolsChangedEvent } from '@/lib/mcp/types'

const logger = createLogger('McpPubSub')

const CHANNEL_TOOLS_CHANGED = 'mcp:tools_changed'
const CHANNEL_WORKFLOW_TOOLS_CHANGED = 'mcp:workflow_tools_changed'

type ToolsChangedHandler = (event: ToolsChangedEvent) => void
type WorkflowToolsChangedHandler = (event: WorkflowToolsChangedEvent) => void

interface McpPubSubAdapter {
  publishToolsChanged(event: ToolsChangedEvent): void
  publishWorkflowToolsChanged(event: WorkflowToolsChangedEvent): void
  onToolsChanged(handler: ToolsChangedHandler): () => void
  onWorkflowToolsChanged(handler: WorkflowToolsChangedHandler): () => void
  dispose(): void
}

/**
 * Redis-backed pub/sub adapter.
 * Uses dedicated pub and sub clients (ioredis requires separate connections for subscribers).
 */
class RedisMcpPubSub implements McpPubSubAdapter {
  private pub: Redis
  private sub: Redis
  private toolsChangedHandlers = new Set<ToolsChangedHandler>()
  private workflowToolsChangedHandlers = new Set<WorkflowToolsChangedHandler>()
  private disposed = false

  constructor(redisUrl: string) {
    const commonOpts = {
      keepAlive: 1000,
      connectTimeout: 10000,
      maxRetriesPerRequest: null as unknown as number,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => {
        if (times > 10) return 30000
        return Math.min(times * 500, 5000)
      },
    }

    this.pub = new Redis(redisUrl, { ...commonOpts, connectionName: 'mcp-pubsub-pub' })
    this.sub = new Redis(redisUrl, { ...commonOpts, connectionName: 'mcp-pubsub-sub' })

    this.pub.on('error', (err) => logger.error('MCP pub/sub publish client error:', err.message))
    this.sub.on('error', (err) => logger.error('MCP pub/sub subscribe client error:', err.message))
    this.pub.on('connect', () => logger.info('MCP pub/sub publish client connected'))
    this.sub.on('connect', () => logger.info('MCP pub/sub subscribe client connected'))

    this.sub.subscribe(CHANNEL_TOOLS_CHANGED, CHANNEL_WORKFLOW_TOOLS_CHANGED, (err) => {
      if (err) {
        logger.error('Failed to subscribe to MCP pub/sub channels:', err)
      } else {
        logger.info('Subscribed to MCP pub/sub channels')
      }
    })

    this.sub.on('message', (channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message)
        if (channel === CHANNEL_TOOLS_CHANGED) {
          for (const handler of this.toolsChangedHandlers) {
            try {
              handler(parsed as ToolsChangedEvent)
            } catch (err) {
              logger.error('Error in tools_changed handler:', err)
            }
          }
        } else if (channel === CHANNEL_WORKFLOW_TOOLS_CHANGED) {
          for (const handler of this.workflowToolsChangedHandlers) {
            try {
              handler(parsed as WorkflowToolsChangedEvent)
            } catch (err) {
              logger.error('Error in workflow_tools_changed handler:', err)
            }
          }
        }
      } catch (err) {
        logger.error('Failed to parse pub/sub message:', err)
      }
    })
  }

  publishToolsChanged(event: ToolsChangedEvent): void {
    if (this.disposed) return
    this.pub.publish(CHANNEL_TOOLS_CHANGED, JSON.stringify(event)).catch((err) => {
      logger.error('Failed to publish tools_changed:', err)
    })
  }

  publishWorkflowToolsChanged(event: WorkflowToolsChangedEvent): void {
    if (this.disposed) return
    this.pub.publish(CHANNEL_WORKFLOW_TOOLS_CHANGED, JSON.stringify(event)).catch((err) => {
      logger.error('Failed to publish workflow_tools_changed:', err)
    })
  }

  onToolsChanged(handler: ToolsChangedHandler): () => void {
    this.toolsChangedHandlers.add(handler)
    return () => {
      this.toolsChangedHandlers.delete(handler)
    }
  }

  onWorkflowToolsChanged(handler: WorkflowToolsChangedHandler): () => void {
    this.workflowToolsChangedHandlers.add(handler)
    return () => {
      this.workflowToolsChangedHandlers.delete(handler)
    }
  }

  dispose(): void {
    this.disposed = true
    this.toolsChangedHandlers.clear()
    this.workflowToolsChangedHandlers.clear()

    const noop = () => {}
    this.pub.removeAllListeners()
    this.sub.removeAllListeners()
    this.pub.on('error', noop)
    this.sub.on('error', noop)

    this.sub.unsubscribe().catch(noop)
    this.pub.quit().catch(noop)
    this.sub.quit().catch(noop)
    logger.info('Redis MCP pub/sub disposed')
  }
}

/**
 * Process-local fallback using EventEmitter.
 * Used when Redis is not configured — notifications only reach listeners in the same process.
 */
class LocalMcpPubSub implements McpPubSubAdapter {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
    logger.info('MCP pub/sub: Using process-local EventEmitter (Redis not configured)')
  }

  publishToolsChanged(event: ToolsChangedEvent): void {
    this.emitter.emit(CHANNEL_TOOLS_CHANGED, event)
  }

  publishWorkflowToolsChanged(event: WorkflowToolsChangedEvent): void {
    this.emitter.emit(CHANNEL_WORKFLOW_TOOLS_CHANGED, event)
  }

  onToolsChanged(handler: ToolsChangedHandler): () => void {
    this.emitter.on(CHANNEL_TOOLS_CHANGED, handler)
    return () => {
      this.emitter.off(CHANNEL_TOOLS_CHANGED, handler)
    }
  }

  onWorkflowToolsChanged(handler: WorkflowToolsChangedHandler): () => void {
    this.emitter.on(CHANNEL_WORKFLOW_TOOLS_CHANGED, handler)
    return () => {
      this.emitter.off(CHANNEL_WORKFLOW_TOOLS_CHANGED, handler)
    }
  }

  dispose(): void {
    this.emitter.removeAllListeners()
    logger.info('Local MCP pub/sub disposed')
  }
}

/**
 * Create the appropriate pub/sub adapter based on Redis availability.
 */
function createMcpPubSub(): McpPubSubAdapter {
  const redisUrl = env.REDIS_URL

  if (redisUrl) {
    try {
      logger.info('MCP pub/sub: Using Redis')
      return new RedisMcpPubSub(redisUrl)
    } catch (err) {
      logger.error('Failed to create Redis pub/sub, falling back to local:', err)
      return new LocalMcpPubSub()
    }
  }

  return new LocalMcpPubSub()
}

export const mcpPubSub: McpPubSubAdapter =
  typeof window !== 'undefined' ? (null as unknown as McpPubSubAdapter) : createMcpPubSub()
