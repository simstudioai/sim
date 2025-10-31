/**
 * DAGBuilder
 * 
 * Orchestrates the construction of a DAG from a serialized workflow.
 * Uses a phase-based approach for clarity and maintainability.
 * 
 * Phases:
 * 1. ReachabilityPhase - Find blocks reachable from trigger
 * 2. ConfigFilterPhase - Filter loop/parallel configs  
 * 3. LoopSentinelPhase - Create loop sentinel nodes
 * 4. NodeCreationPhase - Create DAG nodes (regular + parallel expansion)
 * 5. EdgeWiringPhase - Wire all edges
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  SerializedWorkflow,
  SerializedBlock,
  SerializedLoop,
  SerializedParallel,
} from '@/serializer/types'
import type { DAGEdge, NodeMetadata } from './types'
import { ReachabilityPhase } from './phases/reachability-phase'
import { ConfigFilterPhase } from './phases/config-filter-phase'
import { LoopSentinelPhase } from './phases/loop-sentinel-phase'
import { NodeCreationPhase } from './phases/node-creation-phase'
import { EdgeWiringPhase } from './phases/edge-wiring-phase'

const logger = createLogger('DAGBuilder')

export interface DAGNode {
  id: string
  block: SerializedBlock
  incomingEdges: Set<string>
  outgoingEdges: Map<string, DAGEdge>
  metadata: NodeMetadata
}

export interface DAG {
  nodes: Map<string, DAGNode>
  loopConfigs: Map<string, SerializedLoop>
  parallelConfigs: Map<string, SerializedParallel>
}

/**
 * Builds a DAG from a serialized workflow using a phase-based approach
 */
export class DAGBuilder {
  private reachabilityPhase = new ReachabilityPhase()
  private configFilterPhase = new ConfigFilterPhase()
  private loopSentinelPhase = new LoopSentinelPhase()
  private nodeCreationPhase = new NodeCreationPhase()
  private edgeWiringPhase = new EdgeWiringPhase()

  build(workflow: SerializedWorkflow, startBlockId?: string): DAG {
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }

    // Initialize configs
    this.initializeConfigs(workflow, dag)

    // Phase 1: Find reachable blocks
    const reachableBlocks = this.reachabilityPhase.execute(workflow, startBlockId)
    logger.debug('Reachable blocks from start:', {
      startBlockId,
      reachableCount: reachableBlocks.size,
      totalBlocks: workflow.blocks.length,
    })

    // Phase 2: Filter configs to reachable blocks
    this.configFilterPhase.execute(dag, reachableBlocks)

    // Phase 3: Create loop sentinels
    this.loopSentinelPhase.execute(dag, reachableBlocks)

    // Phase 4: Create nodes (regular + parallel expansion)
    const { blocksInLoops, blocksInParallels } = this.nodeCreationPhase.execute(
      workflow,
      dag,
      reachableBlocks
    )

    // Phase 5: Wire all edges
    this.edgeWiringPhase.execute(
      workflow,
      dag,
      blocksInParallels,
      blocksInLoops,
      reachableBlocks
    )

    logger.info('DAG built', {
      totalNodes: dag.nodes.size,
      loopCount: dag.loopConfigs.size,
      parallelCount: dag.parallelConfigs.size,
    })

    return dag
  }

  /**
   * Initialize loop and parallel configs from workflow
   */
  private initializeConfigs(workflow: SerializedWorkflow, dag: DAG): void {
    if (workflow.loops) {
      for (const [loopId, loopConfig] of Object.entries(workflow.loops)) {
        dag.loopConfigs.set(loopId, loopConfig)
      }
    }

    if (workflow.parallels) {
      for (const [parallelId, parallelConfig] of Object.entries(workflow.parallels)) {
        dag.parallelConfigs.set(parallelId, parallelConfig)
      }
    }
  }
}

