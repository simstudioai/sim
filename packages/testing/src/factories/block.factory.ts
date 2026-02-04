import type { BlockData, BlockOutput, Position } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Options for creating a mock block.
 * All fields are optional - sensible defaults are provided.
 * Uses `any` for subBlocks to accept any app type without conflicts.
 */
export interface BlockFactoryOptions {
  id?: string
  type?: string
  name?: string
  position?: Position
  subBlocks?: Record<string, any>
  outputs?: Record<string, BlockOutput>
  enabled?: boolean
  horizontalHandles?: boolean
  height?: number
  advancedMode?: boolean
  triggerMode?: boolean
  data?: BlockData
  parentId?: string
  locked?: boolean
}

/**
 * Generates a unique block ID.
 */
function generateBlockId(prefix = 'block'): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`
}

/**
 * Creates a mock block with sensible defaults.
 * Override any property as needed.
 *
 * @example
 * ```ts
 * // Basic block
 * const block = createBlock({ type: 'agent' })
 *
 * // Block with specific position
 * const block = createBlock({ type: 'function', position: { x: 100, y: 200 } })
 *
 * // Block with parent (for loops/parallels)
 * const block = createBlock({ type: 'function', parentId: 'loop-1' })
 * ```
 */
export function createBlock(options: BlockFactoryOptions = {}): any {
  const id = options.id ?? generateBlockId(options.type ?? 'block')

  const data: BlockData = options.data ?? {}
  if (options.parentId) {
    data.parentId = options.parentId
    data.extent = 'parent'
  }

  return {
    id,
    type: options.type ?? 'function',
    name: options.name ?? `Block ${id.substring(0, 8)}`,
    position: options.position ?? { x: 0, y: 0 },
    subBlocks: options.subBlocks ?? {},
    outputs: options.outputs ?? {},
    enabled: options.enabled ?? true,
    horizontalHandles: options.horizontalHandles ?? true,
    height: options.height ?? 0,
    advancedMode: options.advancedMode ?? false,
    triggerMode: options.triggerMode ?? false,
    locked: options.locked ?? false,
    data: Object.keys(data).length > 0 ? data : undefined,
    layout: {},
  }
}

/**
 * Creates a starter block (workflow entry point).
 */
export function createStarterBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'starter',
    name: options.name ?? 'Start',
  })
}

/**
 * Creates an agent block (AI agent execution).
 */
export function createAgentBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'agent',
    name: options.name ?? 'Agent',
  })
}

/**
 * Creates a function block (code execution).
 */
export function createFunctionBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'function',
    name: options.name ?? 'Function',
  })
}

/**
 * Creates a condition block (branching logic).
 */
export function createConditionBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'condition',
    name: options.name ?? 'Condition',
  })
}

/**
 * Creates a loop block (iteration container).
 */
export function createLoopBlock(
  options: Omit<BlockFactoryOptions, 'type'> & {
    loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
    count?: number
  } = {}
): any {
  const data: BlockData = {
    ...options.data,
    loopType: options.loopType ?? 'for',
    count: options.count ?? 3,
    type: 'loop',
  }

  return createBlock({
    ...options,
    type: 'loop',
    name: options.name ?? 'Loop',
    data,
  })
}

/**
 * Creates a parallel block (concurrent execution container).
 */
export function createParallelBlock(
  options: Omit<BlockFactoryOptions, 'type'> & {
    parallelType?: 'count' | 'collection'
    count?: number
  } = {}
): any {
  const data: BlockData = {
    ...options.data,
    parallelType: options.parallelType ?? 'count',
    count: options.count ?? 2,
    type: 'parallel',
  }

  return createBlock({
    ...options,
    type: 'parallel',
    name: options.name ?? 'Parallel',
    data,
  })
}

/**
 * Creates a router block (output routing).
 */
export function createRouterBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'router',
    name: options.name ?? 'Router',
  })
}

/**
 * Creates an API block (HTTP requests).
 */
export function createApiBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'api',
    name: options.name ?? 'API',
  })
}

/**
 * Creates a response block (workflow output).
 */
export function createResponseBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'response',
    name: options.name ?? 'Response',
  })
}

/**
 * Creates a webhook trigger block.
 */
export function createWebhookBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'webhook',
    name: options.name ?? 'Webhook',
  })
}

/**
 * Creates a knowledge block (vector search).
 */
export function createKnowledgeBlock(options: Omit<BlockFactoryOptions, 'type'> = {}): any {
  return createBlock({
    ...options,
    type: 'knowledge',
    name: options.name ?? 'Knowledge',
  })
}
