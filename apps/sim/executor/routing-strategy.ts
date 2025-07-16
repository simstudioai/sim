export enum BlockCategory {
  ROUTING_BLOCK = 'routing', // router, condition - make routing decisions
  FLOW_CONTROL = 'flow-control', // parallel, loop - control execution flow
  REGULAR_BLOCK = 'regular', // function, agent, etc. - regular execution
}

export interface RoutingBehavior {
  shouldActivateDownstream: boolean
  requiresActivePathCheck: boolean
  skipInSelectiveActivation: boolean
}

/**
 * Centralized routing strategy that defines how different block types
 * should behave in the execution path system.
 */
export class RoutingStrategy {
  private static readonly BEHAVIOR_MAP: Record<BlockCategory, RoutingBehavior> = {
    [BlockCategory.ROUTING_BLOCK]: {
      shouldActivateDownstream: true,
      requiresActivePathCheck: false,
      skipInSelectiveActivation: false,
    },
    [BlockCategory.FLOW_CONTROL]: {
      shouldActivateDownstream: false,
      requiresActivePathCheck: true,
      skipInSelectiveActivation: true,
    },
    [BlockCategory.REGULAR_BLOCK]: {
      shouldActivateDownstream: true,
      requiresActivePathCheck: false,
      skipInSelectiveActivation: false,
    },
  }

  private static readonly BLOCK_TYPE_TO_CATEGORY: Record<string, BlockCategory> = {
    // Flow control blocks
    parallel: BlockCategory.FLOW_CONTROL,
    loop: BlockCategory.FLOW_CONTROL,

    // Routing blocks
    router: BlockCategory.ROUTING_BLOCK,
    condition: BlockCategory.ROUTING_BLOCK,

    // Regular blocks (default category)
    function: BlockCategory.REGULAR_BLOCK,
    agent: BlockCategory.REGULAR_BLOCK,
    api: BlockCategory.REGULAR_BLOCK,
    evaluator: BlockCategory.REGULAR_BLOCK,
    response: BlockCategory.REGULAR_BLOCK,
    workflow: BlockCategory.REGULAR_BLOCK,
    starter: BlockCategory.REGULAR_BLOCK,
  }

  static getCategory(blockType: string): BlockCategory {
    return RoutingStrategy.BLOCK_TYPE_TO_CATEGORY[blockType] || BlockCategory.REGULAR_BLOCK
  }

  static getBehavior(blockType: string): RoutingBehavior {
    const category = RoutingStrategy.getCategory(blockType)
    return RoutingStrategy.BEHAVIOR_MAP[category]
  }

  static shouldActivateDownstream(blockType: string): boolean {
    return RoutingStrategy.getBehavior(blockType).shouldActivateDownstream
  }

  static requiresActivePathCheck(blockType: string): boolean {
    return RoutingStrategy.getBehavior(blockType).requiresActivePathCheck
  }

  static shouldSkipInSelectiveActivation(blockType: string): boolean {
    return RoutingStrategy.getBehavior(blockType).skipInSelectiveActivation
  }

  /**
   * Checks if a connection should be skipped during selective activation
   */
  static shouldSkipConnection(sourceHandle: string | undefined, targetBlockType: string): boolean {
    // Skip flow control blocks
    if (RoutingStrategy.shouldSkipInSelectiveActivation(targetBlockType)) {
      return true
    }

    // Skip flow control specific connections
    const flowControlHandles = [
      'parallel-start-source',
      'parallel-end-source',
      'loop-start-source',
      'loop-end-source',
    ]

    return flowControlHandles.includes(sourceHandle || '')
  }
}
