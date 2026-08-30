import { createLogger } from '@sim/logger'
import {
  RunBlock,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
} from '@/lib/mothership/generated/tool-catalog-v1'
import { createServerToolHandler } from '@/lib/mothership/tools/registry/server-tool-adapter'
import { getRegisteredServerToolNames } from '@/lib/mothership/tools/server/router'
import {
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
} from '../tools/handlers/workflow/mutations'
import { registerHandlers } from './executor'
import type { ToolHandler } from './types'

const logger = createLogger('ToolHandlerRegistration')

let registered = false

export function ensureHandlersRegistered(): void {
  if (registered) return
  registered = true
  registerHandlers(buildHandlerMap())
  logger.info('Tool handlers registered')
}

/**
 * Bridge: handler implementations accept specific param types while ToolHandler accepts
 * Record<string, unknown>. The params are cast internally by each implementation.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional bridge — each handler narrows internally
function h(fn: (params: any, context: any) => Promise<any>): ToolHandler {
  return fn as ToolHandler
}

/**
 * EXACTLY the worker's emitted tool surface, nothing more (revamp M6): the four
 * client-routed workflow-run tools (executed server-side on headless surfaces, in the
 * browser on interactive ones) plus the sim-routed server tools from the trimmed
 * registry. Integration/MCP calls dispatch through the main tools registry, not here.
 */
function buildHandlerMap(): Record<string, ToolHandler> {
  return {
    [RunWorkflow.id]: h(executeRunWorkflow),
    [RunWorkflowUntilBlock.id]: h(executeRunWorkflowUntilBlock),
    [RunFromBlock.id]: h(executeRunFromBlock),
    [RunBlock.id]: h(executeRunBlock),
    ...buildServerToolHandlers(),
  }
}

function buildServerToolHandlers(): Record<string, ToolHandler> {
  const toolNames = getRegisteredServerToolNames()
  const handlers: Record<string, ToolHandler> = {}
  for (const toolId of toolNames) {
    handlers[toolId] = createServerToolHandler(toolId)
  }
  return handlers
}
