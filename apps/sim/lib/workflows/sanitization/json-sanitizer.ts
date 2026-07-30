import { isRecordLike, sortObjectKeysDeep } from '@sim/utils/object'
import type { Edge } from 'reactflow'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import {
  buildSubBlockValues,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { TRIGGER_WEBHOOK_URL_FIELD } from '@/triggers/constants'

/**
 * Sanitized workflow state for copilot (removes all UI-specific data)
 * Connections are embedded in blocks for consistency with operations format
 * Loops and parallels use nested structure - no separate loops/parallels objects
 */
export interface CopilotWorkflowState {
  blocks: Record<string, CopilotBlockState>
}

/**
 * Block state for copilot (no positions, no UI dimensions, no redundant IDs)
 * Connections are embedded here instead of separate edges array
 * Loops and parallels have nested structure for clarity
 */
interface CopilotBlockState {
  type: string
  name: string
  inputs?: Record<string, string | number | string[][] | object>
  connections?: Record<string, string | string[]>
  nestedNodes?: Record<string, CopilotBlockState>
  enabled: boolean
  advancedMode?: boolean
  triggerMode?: boolean
}

/**
 * Edge state for copilot (only semantic connection data)
 */
interface CopilotEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Export workflow state (includes positions but removes secrets)
 */
export interface ExportWorkflowState {
  version: string
  exportedAt: string
  state: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
    metadata?: {
      name?: string
      description?: string
      sortOrder?: number
      exportedAt?: string
    }
    variables?: Record<
      string,
      {
        id: string
        name: string
        type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
        value: unknown
      }
    >
  }
}

/** Condition structure for sanitization */
interface SanitizedCondition {
  id: string
  title: string
  value: string
}

function toSanitizedCondition(condition: unknown): SanitizedCondition {
  const record = isRecordLike(condition) ? condition : {}
  return {
    id: String(record.id ?? ''),
    title: String(record.title ?? ''),
    value: String(record.value ?? ''),
  }
}

function parseArrayValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseConditions(value: unknown): Array<{ id: string; title: string }> | null {
  const items = parseArrayValue(value)
  if (!items) {
    return null
  }

  const conditions: Array<{ id: string; title: string }> = []
  for (const item of items) {
    if (!isRecordLike(item) || typeof item.id !== 'string') {
      return null
    }
    conditions.push({
      id: item.id,
      title: typeof item.title === 'string' ? item.title : '',
    })
  }

  return conditions
}

function parseRoutes(value: unknown): Array<{ id: string; title?: string }> | null {
  const items = parseArrayValue(value)
  if (!items) {
    return null
  }

  const routes: Array<{ id: string; title?: string }> = []
  for (const item of items) {
    if (!isRecordLike(item) || typeof item.id !== 'string') {
      return null
    }
    routes.push({
      id: item.id,
      title: typeof item.title === 'string' ? item.title : undefined,
    })
  }

  return routes
}

/**
 * Sanitize condition blocks by removing UI-specific metadata
 * Returns cleaned JSON string (not parsed array)
 */
function sanitizeConditions(conditionsJson: string): string {
  try {
    const conditions: unknown = JSON.parse(conditionsJson)
    if (!Array.isArray(conditions)) return conditionsJson

    // Keep only id, title, and value - remove UI state
    const cleaned: SanitizedCondition[] = conditions.map(toSanitizedCondition)

    return JSON.stringify(cleaned)
  } catch {
    return conditionsJson
  }
}

/** Tool input structure for sanitization */
interface ToolInput {
  type: string
  customToolId?: string
  schema?: {
    type?: string
    function?: {
      name: string
      description?: string
      parameters?: unknown
    }
  }
  code?: string
  title?: string
  toolId?: string
  usageControl?: string
  isExpanded?: boolean
  [key: string]: unknown
}

/** Sanitized tool output structure */
interface SanitizedTool {
  type: string
  customToolId?: string
  usageControl?: string
  title?: string
  toolId?: string
  schema?: {
    type: string
    function: {
      name: string
      description?: string
      parameters?: unknown
    }
  }
  code?: string
  [key: string]: unknown
}

/**
 * Sanitize tools array by removing UI state and redundant fields
 */
function sanitizeTools(tools: ToolInput[]): SanitizedTool[] {
  return tools.map((tool): SanitizedTool => {
    if (tool.type === 'custom-tool') {
      // New reference format: minimal fields only
      if (tool.customToolId && !tool.schema && !tool.code) {
        return {
          type: tool.type,
          customToolId: tool.customToolId,
          usageControl: tool.usageControl,
        }
      }

      // Legacy inline format: include all fields
      const sanitized: SanitizedTool = {
        type: tool.type,
        title: tool.title,
        toolId: tool.toolId,
        usageControl: tool.usageControl,
      }

      // Include schema for inline format (legacy format)
      if (tool.schema?.function) {
        sanitized.schema = {
          type: tool.schema.type || 'function',
          function: {
            name: tool.schema.function.name,
            description: tool.schema.function.description,
            parameters: tool.schema.function.parameters,
          },
        }
      }

      // Include code for inline format (legacy format)
      if (tool.code) {
        sanitized.code = tool.code
      }

      return sanitized
    }

    const { isExpanded: _isExpanded, ...cleanTool } = tool
    return cleanTool as SanitizedTool
  })
}

function isToolInput(value: unknown): value is ToolInput {
  return isRecordLike(value) && typeof value.type === 'string'
}

/**
 * Sanitize subblocks by removing null values and simplifying structure
 * Maps each subblock key directly to its value instead of the full object
 *
 * @remarks
 * `tagFilters` and `documentTags` are deliberately retained. This is the copilot's read
 * view of workflow state, and `edit_workflow` can write both keys, so dropping them here
 * makes the field write-only: the agent reads back an absent field and clears the user's
 * filter on the next edit. Redaction for shared/exported workflows is a separate concern,
 * already handled by `sanitizeWorkflowForSharing`.
 */
function sanitizeSubBlocks(
  subBlocks: BlockState['subBlocks']
): Record<string, string | number | string[][] | object> {
  const sanitized: Record<string, string | number | string[][] | object> = {}

  Object.entries(subBlocks).forEach(([key, subBlock]) => {
    // Skip null/undefined values
    if (subBlock.value === null || subBlock.value === undefined) {
      return
    }

    // Normalize responseFormat for consistent key ordering (important for training data)
    if (key === 'responseFormat') {
      try {
        let obj = subBlock.value

        // Parse JSON string if needed
        if (typeof subBlock.value === 'string') {
          const trimmed = subBlock.value.trim()
          if (!trimmed) {
            return
          }
          obj = JSON.parse(trimmed)
        }

        // Sort keys for consistent comparison
        if (obj && typeof obj === 'object') {
          sanitized[key] = sortObjectKeysDeep(obj) as Record<string, unknown>
          return
        }
      } catch {
        // Invalid JSON - pass through as-is
        sanitized[key] = subBlock.value
        return
      }
    }

    // Special handling for condition-input type - clean UI metadata
    if (subBlock.type === 'condition-input') {
      if (typeof subBlock.value === 'string') {
        sanitized[key] = sanitizeConditions(subBlock.value)
      } else if (Array.isArray(subBlock.value)) {
        sanitized[key] = subBlock.value.map(toSanitizedCondition)
      } else {
        sanitized[key] = subBlock.value
      }
      return
    }

    if (key === 'tools' && Array.isArray(subBlock.value)) {
      const toolItems: unknown[] = subBlock.value
      sanitized[key] = sanitizeTools(toolItems.filter(isToolInput))
      return
    }

    sanitized[key] = subBlock.value
  })

  return sanitized
}

/**
 * Resolves the public webhook URL for a block acting as a webhook trigger, or null
 * for any other block. Mirrors the UI derivation (`useWebhookManagement`):
 * `{baseUrl}/api/webhooks/trigger/{triggerPath || blockId}`.
 *
 * The webhook URL only ever exists as a UI-computed display field
 * (`webhookUrlDisplay`, never persisted), which left the copilot unable to tell
 * users where to point their external service. This surfaces it in the copilot's
 * read view as the read-only {@link TRIGGER_WEBHOOK_URL_FIELD} input — derived at
 * read time, never stored, and rejected on write by `edit_workflow` validation.
 */
function resolveTriggerWebhookUrl(blockId: string, block: BlockState): string | null {
  const blockConfig = getBlock(block.type)
  if (!blockConfig) return null

  const actsAsTrigger = blockConfig.category === 'triggers' || block.triggerMode === true
  if (!actsAsTrigger) return null

  // A webhook-URL display subblock (`useWebhookUrl`) marks a webhook-based trigger.
  // Multi-trigger blocks namespace one per trigger id, each gated by a condition on
  // selectedTriggerId — only count a field active for the current values, so a block
  // configured with a polling trigger doesn't advertise a webhook URL.
  const values = buildSubBlockValues(block.subBlocks || {})
  const hasActiveWebhookUrlField = blockConfig.subBlocks.some(
    (sb) => sb.useWebhookUrl === true && evaluateSubBlockCondition(sb.condition, values)
  )
  if (!hasActiveWebhookUrlField) return null

  const triggerPath = block.subBlocks?.triggerPath?.value
  const path = typeof triggerPath === 'string' && triggerPath.length > 0 ? triggerPath : blockId
  try {
    return `${getBaseUrl()}/api/webhooks/trigger/${path}`
  } catch {
    // getBaseUrl throws when NEXT_PUBLIC_APP_URL is unset; omit the field rather
    // than fail the whole state read.
    return null
  }
}

/**
 * Convert internal condition handle (condition-{uuid}) to simple format (if, else-if-0, else)
 * Uses 0-indexed numbering for else-if conditions
 */
function convertConditionHandleToSimple(
  handle: string,
  _blockId: string,
  block: BlockState
): string {
  if (!handle.startsWith('condition-')) {
    return handle
  }

  // Extract the condition UUID from the handle
  const conditionId = handle.substring('condition-'.length)

  // Get conditions from block subBlocks (may be JSON string or array)
  const conditionsValue = block.subBlocks?.conditions?.value
  if (!conditionsValue) {
    return handle
  }

  const conditions = parseConditions(conditionsValue)
  if (!conditions) {
    return handle
  }

  // Find the condition by ID and generate simple handle
  let elseIfIndex = 0
  for (const condition of conditions) {
    const title = condition.title?.toLowerCase()
    if (condition.id === conditionId) {
      if (title === 'if') {
        return 'if'
      }
      if (title === 'else if') {
        return `else-if-${elseIfIndex}`
      }
      if (title === 'else') {
        return 'else'
      }
    }
    // Count else-ifs as we iterate (for index tracking)
    if (title === 'else if') {
      elseIfIndex++
    }
  }

  // Fallback: return original handle if condition not found
  return handle
}

/**
 * Convert internal router handle (router-{uuid}) to simple format (route-0, route-1)
 * Uses 0-indexed numbering for routes
 */
function convertRouterHandleToSimple(handle: string, _blockId: string, block: BlockState): string {
  if (!handle.startsWith('router-')) {
    return handle
  }

  // Extract the route UUID from the handle
  const routeId = handle.substring('router-'.length)

  // Get routes from block subBlocks (may be JSON string or array)
  const routesValue = block.subBlocks?.routes?.value
  if (!routesValue) {
    return handle
  }

  const routes = parseRoutes(routesValue)
  if (!routes) {
    return handle
  }

  // Find the route by ID and generate simple handle (0-indexed)
  for (let i = 0; i < routes.length; i++) {
    if (routes[i].id === routeId) {
      return `route-${i}`
    }
  }

  // Fallback: return original handle if route not found
  return handle
}

/**
 * Convert source handle to simple format for condition and router blocks
 * Outputs: if, else-if-0, else (for conditions) and route-0, route-1 (for routers)
 */
function convertToSimpleHandle(handle: string, blockId: string, block: BlockState): string {
  if (handle.startsWith('condition-') && block.type === 'condition') {
    return convertConditionHandleToSimple(handle, blockId, block)
  }

  if (handle.startsWith('router-') && block.type === 'router_v2') {
    return convertRouterHandleToSimple(handle, blockId, block)
  }

  return handle
}

/**
 * Extract connections for a block from edges and format as operations-style connections
 * Converts internal UUID handles to semantic format for training data
 */
function extractConnectionsForBlock(
  blockId: string,
  edges: WorkflowState['edges'],
  block: BlockState
): Record<string, string | string[]> | undefined {
  const connections: Record<string, string[]> = {}

  // Find all outgoing edges from this block
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  if (outgoingEdges.length === 0) {
    return undefined
  }

  // Group by source handle (converting to simple format)
  for (const edge of outgoingEdges) {
    let handle = edge.sourceHandle || 'source'

    // Convert internal UUID handles to simple format (if, else-if-0, route-0, etc.)
    handle = convertToSimpleHandle(handle, blockId, block)

    if (!connections[handle]) {
      connections[handle] = []
    }

    connections[handle].push(edge.target)
  }

  // Simplify single-element arrays to just the string
  const simplified: Record<string, string | string[]> = {}
  for (const [handle, targets] of Object.entries(connections)) {
    simplified[handle] = targets.length === 1 ? targets[0] : targets
  }

  return simplified
}

/**
 * Sanitize workflow state for copilot by removing all UI-specific data
 * Creates nested structure for loops/parallels with their child blocks inside
 */
export function sanitizeForCopilot(state: WorkflowState): CopilotWorkflowState {
  const sanitizedBlocks: Record<string, CopilotBlockState> = {}
  const processedBlocks = new Set<string>()

  // Helper to find child blocks of a parent (loop/parallel container)
  const findChildBlocks = (parentId: string): string[] => {
    return Object.keys(state.blocks).filter(
      (blockId) => state.blocks[blockId].data?.parentId === parentId
    )
  }

  // Helper to recursively sanitize a block and its children
  const sanitizeBlock = (blockId: string, block: BlockState): CopilotBlockState => {
    const connections = extractConnectionsForBlock(blockId, state.edges, block)

    // For loop/parallel blocks, extract config from block.data instead of subBlocks
    let inputs: Record<string, string | number | string[][] | object>

    if (block.type === 'loop' || block.type === 'parallel') {
      // Extract configuration from block.data (only include type-appropriate fields)
      const loopInputs: Record<string, string | number | string[][] | object> = {}

      if (block.type === 'loop') {
        const loopType = block.data?.loopType || 'for'
        loopInputs.loopType = loopType
        // Only export fields relevant to the current loopType
        if (loopType === 'for' && block.data?.count !== undefined) {
          loopInputs.iterations = block.data.count
        }
        if (loopType === 'forEach' && block.data?.collection !== undefined) {
          loopInputs.collection = block.data.collection
        }
        if (loopType === 'while' && block.data?.whileCondition !== undefined) {
          loopInputs.condition = block.data.whileCondition
        }
        if (loopType === 'doWhile' && block.data?.doWhileCondition !== undefined) {
          loopInputs.condition = block.data.doWhileCondition
        }
      } else if (block.type === 'parallel') {
        const parallelType = block.data?.parallelType || 'count'
        loopInputs.parallelType = parallelType
        // Only export fields relevant to the current parallelType
        if (parallelType === 'count' && block.data?.count !== undefined) {
          loopInputs.iterations = block.data.count
        }
        if (parallelType === 'collection' && block.data?.collection !== undefined) {
          loopInputs.collection = block.data.collection
        }
      }

      inputs = loopInputs
    } else {
      // For regular blocks, sanitize subBlocks
      inputs = sanitizeSubBlocks(block.subBlocks)

      const webhookUrl = resolveTriggerWebhookUrl(blockId, block)
      if (webhookUrl) {
        inputs[TRIGGER_WEBHOOK_URL_FIELD] = webhookUrl
      }
    }

    // Check if this is a loop or parallel (has children)
    const childBlockIds = findChildBlocks(blockId)
    const nestedNodes: Record<string, CopilotBlockState> = {}

    if (childBlockIds.length > 0) {
      // Recursively sanitize child blocks
      childBlockIds.forEach((childId) => {
        const childBlock = state.blocks[childId]
        if (childBlock) {
          nestedNodes[childId] = sanitizeBlock(childId, childBlock)
          processedBlocks.add(childId)
        }
      })
    }

    // Create clean result without runtime data (outputs, positions, layout, etc.)
    const result: CopilotBlockState = {
      type: block.type,
      name: block.name,
      enabled: block.enabled,
    }

    if (Object.keys(inputs).length > 0) result.inputs = inputs
    if (connections) result.connections = connections
    if (Object.keys(nestedNodes).length > 0) result.nestedNodes = nestedNodes
    if (block.advancedMode !== undefined) result.advancedMode = block.advancedMode
    if (block.triggerMode !== undefined) result.triggerMode = block.triggerMode

    // Note: outputs, position, height, layout, horizontalHandles are intentionally excluded
    // These are runtime/UI-specific fields not needed for copilot understanding

    return result
  }

  // Process only root-level blocks (those without a parent)
  Object.entries(state.blocks).forEach(([blockId, block]) => {
    // Skip if already processed as a child
    if (processedBlocks.has(blockId)) return

    // Skip if it has a parent (it will be processed as nested)
    if (block.data?.parentId) return

    sanitizedBlocks[blockId] = sanitizeBlock(blockId, block)
  })

  return {
    blocks: sanitizedBlocks,
  }
}

/**
 * Sanitize workflow state for export by removing secrets but keeping positions
 * Users need positions to restore the visual layout when importing
 */
export function sanitizeForExport(state: WorkflowState): ExportWorkflowState {
  const canonicalLoops = generateLoopBlocks(state.blocks || {})
  const canonicalParallels = generateParallelBlocks(state.blocks || {})

  // Preserve edges, loops, parallels, metadata, and variables
  const fullState = {
    blocks: state.blocks,
    edges: state.edges,
    loops: canonicalLoops,
    parallels: canonicalParallels,
    metadata: state.metadata,
    variables: state.variables,
  }

  // Use unified sanitization with env var preservation for export
  const sanitizedState = sanitizeWorkflowForSharing(fullState, {
    preserveEnvVars: true, // Keep {{ENV_VAR}} references in exported workflows
  }) as ExportWorkflowState['state']

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    state: sanitizedState,
  }
}
