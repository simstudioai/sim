import { BlockType } from '@/executor/consts'

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
export class Routing {
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
    [BlockType.PARALLEL]: BlockCategory.FLOW_CONTROL,
    [BlockType.LOOP]: BlockCategory.FLOW_CONTROL,

    // Routing blocks
    [BlockType.ROUTER]: BlockCategory.ROUTING_BLOCK,
    [BlockType.CONDITION]: BlockCategory.ROUTING_BLOCK,

    // Regular blocks (default category)
    [BlockType.FUNCTION]: BlockCategory.REGULAR_BLOCK,
    [BlockType.AGENT]: BlockCategory.REGULAR_BLOCK,
    [BlockType.API]: BlockCategory.REGULAR_BLOCK,
    [BlockType.EVALUATOR]: BlockCategory.REGULAR_BLOCK,
    [BlockType.RESPONSE]: BlockCategory.REGULAR_BLOCK,
    [BlockType.WORKFLOW]: BlockCategory.REGULAR_BLOCK,
    [BlockType.STARTER]: BlockCategory.REGULAR_BLOCK,
  }

  static getCategory(blockType: string): BlockCategory {
    return Routing.BLOCK_TYPE_TO_CATEGORY[blockType] || BlockCategory.REGULAR_BLOCK
  }

  static getBehavior(blockType: string): RoutingBehavior {
    const category = Routing.getCategory(blockType)
    return Routing.BEHAVIOR_MAP[category]
  }

  static shouldActivateDownstream(blockType: string): boolean {
    return Routing.getBehavior(blockType).shouldActivateDownstream
  }

  static requiresActivePathCheck(blockType: string): boolean {
    return Routing.getBehavior(blockType).requiresActivePathCheck
  }

  static shouldSkipInSelectiveActivation(blockType: string): boolean {
    return Routing.getBehavior(blockType).skipInSelectiveActivation
  }

  /**
   * Checks if a connection should be skipped during selective activation
   */
  static shouldSkipConnection(sourceHandle: string | undefined, targetBlockType: string): boolean {
    // Skip flow control specific connections (internal flow control handles)
    const flowControlHandles = [
      'parallel-start-source',
      'parallel-end-source',
      'loop-start-source',
      'loop-end-source',
    ]

    if (flowControlHandles.includes(sourceHandle || '')) {
      return true
    }

    // Skip condition-specific connections during selective activation
    // These should only be activated when the condition makes a specific decision
    if (sourceHandle?.startsWith('condition-')) {
      return true
    }

    // For regular connections (no special source handle), allow activation of flow control blocks
    // This enables regular blocks (like agents) to activate parallel/loop blocks
    // The flow control blocks themselves will handle active path checking
    return false
  }
}
