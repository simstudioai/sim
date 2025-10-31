import { createLogger } from '@/lib/logs/console/logger'
import type {
  SerializedBlock,
  SerializedLoop,
  SerializedParallel,
  SerializedWorkflow,
} from '@/serializer/types'
import { EdgeConstructor } from './construction/edges'
import { LoopConstructor } from './construction/loops'
import { NodeConstructor } from './construction/nodes'
import { PathConstructor } from './construction/paths'
import type { DAGEdge, NodeMetadata } from './types'

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

  build(workflow: SerializedWorkflow, startBlockId?: string): DAG {
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }

    this.initializeConfigs(workflow, dag)

    const reachableBlocks = this.pathConstructor.execute(workflow, startBlockId)
    logger.debug('Reachable blocks from start:', {
      startBlockId,
      reachableCount: reachableBlocks.size,
      totalBlocks: workflow.blocks.length,
    })

    this.loopConstructor.execute(dag, reachableBlocks)

    const { blocksInLoops, blocksInParallels } = this.nodeConstructor.execute(
      workflow,
      dag,
      reachableBlocks
    )

    this.edgeConstructor.execute(workflow, dag, blocksInParallels, blocksInLoops, reachableBlocks)

    logger.info('DAG built', {
      totalNodes: dag.nodes.size,
      loopCount: dag.loopConfigs.size,
      parallelCount: dag.parallelConfigs.size,
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
