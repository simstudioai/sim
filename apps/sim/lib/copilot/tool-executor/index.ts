export {
  executeTool,
  executeToolBatch,
  getRegisteredToolIds,
  hasHandler,
  registerHandler,
  registerHandlers,
} from './executor'
export { ensureHandlersRegistered } from './register-handlers'
export {
  getToolEntry,
  isGoExecuted,
  isKnownTool,
  isSimExecuted,
  type PartitionedBatch,
  partitionToolBatch,
  routeToolCall,
  type ToolRoute,
} from './router'
export type {
  ToolCallDescriptor,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from './types'
