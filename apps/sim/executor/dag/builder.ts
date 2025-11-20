import { createLogger } from '@/lib/logs/console/logger'
import { EdgeConstructor } from '@/executor/dag/construction/edges'
import { LoopConstructor } from '@/executor/dag/construction/loops'
import { NodeConstructor } from '@/executor/dag/construction/nodes'
import { PathConstructor } from '@/executor/dag/construction/paths'
import type { DAGEdge, NodeMetadata } from '@/executor/dag/types'
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

export class DAGBuilder {
  private pathConstructor = new PathConstructor()
  private loopConstructor = new LoopConstructor()
  private nodeConstructor = new NodeConstructor()
  private edgeConstructor = new EdgeConstructor()

  build(
    workflow: SerializedWorkflow,
    triggerBlockId?: string,
    savedIncomingEdges?: Record<string, string[]>
  ): DAG {
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }

    this.initializeConfigs(workflow, dag)

    const reachableBlocks = this.pathConstructor.execute(workflow, triggerBlockId)

    this.loopConstructor.execute(dag, reachableBlocks)

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
}
