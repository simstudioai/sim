import { BlockType } from '@/executor/consts'

export enum BlockCategory {
  ROUTING_BLOCK = 'routing', // router, condition - make routing decisions
  FLOW_CONTROL = 'flow-control', // parallel, loop - control execution flow
  REGULAR_BLOCK = 'regular', // function, agent, etc. - regular execution
}

export interface RoutingBehavior {
  shouldActivateDownstream: boolean // Whether this block should activate downstream blocks when it completes
  requiresActivePathCheck: boolean // Whether this block's handler needs routing-aware logic (NOT universal path checking)
  skipInSelectiveActivation: boolean // Whether to skip this block type during connection filtering in selective activation
}

/**
 * Centralized routing strategy that defines how different block types
 * should behave in the execution path system.
 *
 * IMPORTANT: This system works in conjunction with the executor's universal
 * active path checking (executor/index.ts lines 992-994). The flags here
 * control specialized behavior, not basic path enforcement.
 *
 * ## Execution Flow Architecture:
 *
 * 1. **Universal Path Check** (Executor Level):
 *    - ALL blocks are subject to `context.activeExecutionPath.has(block.id)`
 *    - This prevents unselected blocks from executing (fixes router bypass bug)
 *
 * 2. **Specialized Routing Behavior** (Handler Level):
 *    - Some block handlers need additional routing logic
 *    - Controlled by `requiresActivePathCheck` flag
 *
 * ## Block Categories Explained:
 *
 * ### ROUTING_BLOCK (Router, Condition)
 * - **Role**: Decision makers that CREATE active execution paths
 * - **Path Check**: NO - they must execute to make routing decisions
 * - **Downstream**: YES - they activate their selected targets
 * - **Selective**: NO - they participate in making routing decisions
 *
 * ### FLOW_CONTROL (Parallel, Loop, Workflow)
 * - **Role**: Complex blocks that CONSUME routing decisions
 * - **Path Check**: YES - their handlers need routing awareness for internal logic
 * - **Downstream**: NO - they manage their own internal activation patterns
 * - **Selective**: YES - skip them during connection filtering to prevent premature activation
 *
 * ### REGULAR_BLOCK (Function, Agent, API, etc.)
 * - **Role**: Standard execution blocks with simple activation patterns
 * - **Path Check**: NO - they rely on dependency logic and universal path checking
 * - **Downstream**: YES - they activate all downstream blocks normally
 * - **Selective**: NO - they participate in normal activation patterns
 *
 * ## Multi-Input Support:
 * The dependency checking logic (executor/index.ts lines 1149-1153) allows blocks
 * with multiple inputs to execute when ANY valid input is available, supporting
 * scenarios like agents that reference multiple router destinations.
 */
export class Routing {
  private static readonly BEHAVIOR_MAP: Record<BlockCategory, RoutingBehavior> = {
    [BlockCategory.ROUTING_BLOCK]: {
      shouldActivateDownstream: true, // Routing blocks activate their SELECTED targets (not all connected targets)
      requiresActivePathCheck: false, // They don't need handler-level path checking - they CREATE the paths
      skipInSelectiveActivation: false, // They participate in routing decisions, so don't skip during activation
    },
    [BlockCategory.FLOW_CONTROL]: {
      shouldActivateDownstream: false, // Flow control blocks manage their own complex internal activation
      requiresActivePathCheck: true, // Their handlers need routing context for internal decision making
      skipInSelectiveActivation: true, // Skip during selective activation to prevent bypassing routing decisions
    },
    [BlockCategory.REGULAR_BLOCK]: {
      shouldActivateDownstream: true, // Regular blocks activate all connected downstream blocks
      requiresActivePathCheck: false, // They use universal path checking + dependency logic instead
      skipInSelectiveActivation: false, // They participate in normal activation patterns
    },
  }

  private static readonly BLOCK_TYPE_TO_CATEGORY: Record<string, BlockCategory> = {
    // Flow control blocks
    [BlockType.PARALLEL]: BlockCategory.FLOW_CONTROL,
    [BlockType.LOOP]: BlockCategory.FLOW_CONTROL,
    [BlockType.WORKFLOW]: BlockCategory.FLOW_CONTROL,

    // Routing blocks
    [BlockType.ROUTER]: BlockCategory.ROUTING_BLOCK,
    [BlockType.CONDITION]: BlockCategory.ROUTING_BLOCK,

    // Regular blocks (default category)
    [BlockType.FUNCTION]: BlockCategory.REGULAR_BLOCK,
    [BlockType.AGENT]: BlockCategory.REGULAR_BLOCK,
    [BlockType.API]: BlockCategory.REGULAR_BLOCK,
    [BlockType.EVALUATOR]: BlockCategory.REGULAR_BLOCK,
    [BlockType.RESPONSE]: BlockCategory.REGULAR_BLOCK,
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

  /**
   * Determines if a block's HANDLER needs routing-aware logic.
   * Note: This is NOT the same as universal path checking done by the executor.
   *
   * @param blockType The block type to check
   * @returns true if the block handler should implement routing-aware behavior
   */
  static requiresActivePathCheck(blockType: string): boolean {
    return Routing.getBehavior(blockType).requiresActivePathCheck
  }

  /**
   * Determines if a block type should be skipped during selective activation.
   * Used to prevent certain block types from being prematurely activated
   * when they should wait for explicit routing decisions.
   */
  static shouldSkipInSelectiveActivation(blockType: string): boolean {
    return Routing.getBehavior(blockType).skipInSelectiveActivation
  }

  /**
   * Checks if a connection should be skipped during selective activation.
   *
   * This prevents certain types of connections from triggering premature
   * activation of blocks that should wait for explicit routing decisions.
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
