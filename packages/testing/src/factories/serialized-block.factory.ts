/**
 * Factory functions for creating SerializedBlock test fixtures.
 * These are used in executor tests where blocks are in their serialized form.
 */

/**
 * Serialized block structure used in executor tests.
 */
interface SerializedBlock {
  id: string
  position: { x: number; y: number }
  config: {
    tool: string
    params: Record<string, any>
  }
  inputs: Record<string, any>
  outputs: Record<string, any>
  metadata?: {
    id: string
    name?: string
    description?: string
    category?: string
    icon?: string
    color?: string
  }
  enabled: boolean
}

/**
 * Serialized connection structure.
 */
interface SerializedConnection {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Serialized workflow structure.
 */
export interface SerializedWorkflow {
  version: string
  blocks: SerializedBlock[]
  connections: SerializedConnection[]
  loops: Record<string, any>
  parallels?: Record<string, any>
}

/**
 * Options for creating a serialized block.
 */
interface SerializedBlockFactoryOptions {
  id?: string
  type?: string
  name?: string
  description?: string
  position?: { x: number; y: number }
  tool?: string
  params?: Record<string, any>
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  enabled?: boolean
}

let blockCounter = 0

/**
 * Generates a unique block ID.
 */
function generateBlockId(prefix = 'block'): string {
  return `${prefix}-${++blockCounter}`
}

/**
 * Creates a serialized block with sensible defaults.
 *
 * @example
 * ```ts
 * const block = createSerializedBlock({ type: 'agent', name: 'My Agent' })
 * ```
 */
export function createSerializedBlock(
  options: SerializedBlockFactoryOptions = {}
): SerializedBlock {
  const type = options.type ?? 'function'
  const id = options.id ?? generateBlockId(type)

  return {
    id,
    position: options.position ?? { x: 0, y: 0 },
    config: {
      tool: options.tool ?? type,
      params: options.params ?? {},
    },
    inputs: options.inputs ?? {},
    outputs: options.outputs ?? {},
    metadata: {
      id: type,
      name: options.name ?? `Block ${id}`,
      description: options.description,
    },
    enabled: options.enabled ?? true,
  }
}

/**
 * Creates a serialized workflow with the given blocks and connections.
 */
export function createSerializedWorkflow(
  blocks: SerializedBlock[],
  connections: SerializedConnection[] = []
): SerializedWorkflow {
  return {
    version: '1.0',
    blocks,
    connections,
    loops: {},
    parallels: {},
  }
}
