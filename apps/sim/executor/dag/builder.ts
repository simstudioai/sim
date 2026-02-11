import { createLogger } from '@sim/logger'
import { EdgeConstructor } from '@/executor/dag/construction/edges'
import { LoopConstructor } from '@/executor/dag/construction/loops'
import { NodeConstructor } from '@/executor/dag/construction/nodes'
import { ParallelConstructor } from '@/executor/dag/construction/parallels'
import { PathConstructor } from '@/executor/dag/construction/paths'
import type { DAGEdge, NodeMetadata } from '@/executor/dag/types'
import {
  buildParallelSentinelStartId,
  buildSentinelStartId,
  extractBaseBlockId,
} from '@/executor/utils/subflow-utils'
import type {
  SerializedBlock,
  SerializedLoop,
  SerializedParallel,
  SerializedWorkflow,
} from '@/serializer/types'

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

export interface DAGBuildOptions {
  /** Trigger block ID to start path construction from */
  triggerBlockId?: string
  /** Saved incoming edges from snapshot for resumption */
  savedIncomingEdges?: Record<string, string[]>
  /** Include all enabled blocks instead of only those reachable from trigger */
  includeAllBlocks?: boolean
}

export class DAGBuilder {
  private pathConstructor = new PathConstructor()
  private loopConstructor = new LoopConstructor()
  private parallelConstructor = new ParallelConstructor()
  private nodeConstructor = new NodeConstructor()
  private edgeConstructor = new EdgeConstructor()

  build(workflow: SerializedWorkflow, options: DAGBuildOptions = {}): DAG {
    const { triggerBlockId, savedIncomingEdges, includeAllBlocks } = options

    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }

    this.initializeConfigs(workflow, dag)

    const reachableBlocks = this.pathConstructor.execute(workflow, triggerBlockId, includeAllBlocks)

    this.loopConstructor.execute(dag, reachableBlocks)
    this.parallelConstructor.execute(dag, reachableBlocks)

    const { blocksInLoops, blocksInParallels, pauseTriggerMapping } = this.nodeConstructor.execute(
      workflow,
      dag,
      reachableBlocks
    )

    this.edgeConstructor.execute(
      workflow,
      dag,
      blocksInParallels,
      blocksInLoops,
      reachableBlocks,
      pauseTriggerMapping
    )

    if (savedIncomingEdges) {
      logger.info('Restoring DAG incoming edges from snapshot', {
        nodeCount: Object.keys(savedIncomingEdges).length,
      })

      for (const [nodeId, incomingEdgeArray] of Object.entries(savedIncomingEdges)) {
        const node = dag.nodes.get(nodeId)

        if (node) {
          node.incomingEdges = new Set(incomingEdgeArray)
        }
      }
    }

    // Validate loop and parallel structure
    this.validateSubflowStructure(dag)

    logger.info('DAG built', {
      totalNodes: dag.nodes.size,
      loopCount: dag.loopConfigs.size,
      parallelCount: dag.parallelConfigs.size,
      allNodeIds: Array.from(dag.nodes.keys()),
      triggerNodes: Array.from(dag.nodes.values())
        .filter((n) => n.metadata?.isResumeTrigger)
        .map((n) => ({ id: n.id, originalBlockId: n.metadata?.originalBlockId })),
    })

    return dag
  }

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

  /**
   * Validates that loops and parallels have proper internal structure.
   * Throws an error if a loop/parallel has no blocks inside or no connections from start.
   */
  private validateSubflowStructure(dag: DAG): void {
    for (const [id, config] of dag.loopConfigs) {
      this.validateSubflow(dag, id, config.nodes, 'Loop')
    }
    for (const [id, config] of dag.parallelConfigs) {
      this.validateSubflow(dag, id, config.nodes, 'Parallel')
    }
  }

  private validateSubflow(
    dag: DAG,
    id: string,
    nodes: string[] | undefined,
    type: 'Loop' | 'Parallel'
  ): void {
    const sentinelStartId =
      type === 'Loop' ? buildSentinelStartId(id) : buildParallelSentinelStartId(id)
    const sentinelStartNode = dag.nodes.get(sentinelStartId)

    if (!sentinelStartNode) return

    if (!nodes || nodes.length === 0) {
      throw new Error(
        `${type} has no blocks inside. Add at least one block to the ${type.toLowerCase()}.`
      )
    }

    const hasConnections = Array.from(sentinelStartNode.outgoingEdges.values()).some((edge) =>
      nodes.includes(extractBaseBlockId(edge.target))
    )

    if (!hasConnections) {
      throw new Error(
        `${type} start is not connected to any blocks. Connect a block to the ${type.toLowerCase()} start.`
      )
    }
  }
}
