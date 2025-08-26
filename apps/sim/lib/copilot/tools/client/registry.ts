import type { ClientToolDefinition, ToolExecutionContext } from '@/lib/copilot/tools/client/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ClientToolRegistry')

const tools: Record<string, ClientToolDefinition<any>> = {}

export function registerTool(def: ClientToolDefinition<any>) {
  tools[def.name] = def
}

export function getTool(name: string): ClientToolDefinition<any> | undefined {
  return tools[name]
}

export function createExecutionContext(params: {
  toolCallId: string
  toolName: string
}): ToolExecutionContext {
  const { toolCallId, toolName } = params
  return {
    toolCallId,
    toolName,
    log: (level, message, extra) => {
      try {
        logger[level](message, { toolCallId, toolName, ...(extra || {}) })
      } catch {}
    },
  }
}

export function getRegisteredTools(): Record<string, ClientToolDefinition<any>> {
  return { ...tools }
}
