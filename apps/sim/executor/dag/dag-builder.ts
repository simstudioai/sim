/**
 * DAG Builder - Constructs the execution graph from workflow
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow, SerializedBlock } from '@/serializer/types'

const logger = createLogger('DAGBuilder')

export interface DAGNode {
  id: string // Node ID (may include branch suffix for parallels: "A₍0₎")
  block: SerializedBlock // Original block config
  incomingEdges: Set<string> // Source node IDs that feed into this node
  outgoingEdges: Map<
    string,
    {
      target: string
      sourceHandle?: string
      targetHandle?: string
      isActive?: boolean // For conditional routing
    }
  >
  metadata: {
    isParallelBranch?: boolean
    branchIndex?: number
    branchTotal?: number
    distributionItem?: any
    isLoopNode?: boolean
    loopId?: string
  }
}

export interface DAG {
  nodes: Map<string, DAGNode>
  loopConfigs: Map<string, any> // Loop configurations
  parallelConfigs: Map<string, any> // Parallel configurations (before expansion)
}

/**
 * Build DAG from serialized workflow
 * - Expands parallels into branches
 * - Adds backwards-edges for loops
 */
export class DAGBuilder {
  build(workflow: SerializedWorkflow, startBlockId?: string): DAG {
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }

    // Step 1: Store loop and parallel configs
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

    // Step 1.5: Find reachable blocks from start
    const reachableBlocks = this.findReachableBlocks(workflow, startBlockId)
    logger.debug('Reachable blocks from start:', {
      startBlockId,
      reachableCount: reachableBlocks.size,
      totalBlocks: workflow.blocks.length,
    })

    // Step 1.6: Filter loop and parallel configs to only include those with reachable blocks
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const loopNodes = (loopConfig as any).nodes || []
      const reachableLoopNodes = loopNodes.filter((nodeId: string) => reachableBlocks.has(nodeId))
      
      if (reachableLoopNodes.length === 0) {
        logger.debug('Removing unreachable loop:', { loopId, totalNodes: loopNodes.length })
        dag.loopConfigs.delete(loopId)
      } else if (reachableLoopNodes.length < loopNodes.length) {
        // Partial reachability - update config with only reachable nodes
        logger.debug('Filtering loop to reachable nodes:', {
          loopId,
          originalNodes: loopNodes.length,
          reachableNodes: reachableLoopNodes.length,
        })
        ;(loopConfig as any).nodes = reachableLoopNodes
      }
    }

    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const parallelNodes = (parallelConfig as any).nodes || []
      const reachableParallelNodes = parallelNodes.filter((nodeId: string) => reachableBlocks.has(nodeId))
      
      if (reachableParallelNodes.length === 0) {
        logger.debug('Removing unreachable parallel:', { parallelId, totalNodes: parallelNodes.length })
        dag.parallelConfigs.delete(parallelId)
      } else if (reachableParallelNodes.length < parallelNodes.length) {
        // Partial reachability - update config with only reachable nodes
        logger.debug('Filtering parallel to reachable nodes:', {
          parallelId,
          originalNodes: parallelNodes.length,
          reachableNodes: reachableParallelNodes.length,
        })
        ;(parallelConfig as any).nodes = reachableParallelNodes
      }
    }

    // Step 2: Determine which blocks are in loops vs parallels
    const blocksInLoops = new Set<string>()
    const blocksInParallels = new Set<string>()

    for (const [loopId, loopConfig] of dag.loopConfigs) {
      for (const nodeId of (loopConfig as any).nodes || []) {
        // Only add if reachable (should always be true after filtering above)
        if (reachableBlocks.has(nodeId)) {
          blocksInLoops.add(nodeId)
        }
      }
    }

    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      for (const nodeId of (parallelConfig as any).nodes || []) {
        // Only add if reachable (should always be true after filtering above)
        if (reachableBlocks.has(nodeId)) {
          blocksInParallels.add(nodeId)
        }
      }
    }

    // Step 3: Create nodes - only for reachable blocks
    for (const block of workflow.blocks) {
      if (!block.enabled) continue

      // Skip unreachable blocks
      if (!reachableBlocks.has(block.id)) {
        logger.debug('Skipping unreachable block:', block.id)
        continue
      }

      // Skip loop and parallel blocks - they're metadata only, not executable nodes
      if (block.metadata?.id === 'loop' || block.metadata?.id === 'parallel') {
        logger.debug('Skipping loop/parallel block (metadata only):', block.id)
        continue
      }

      // Check if this block is in a parallel
      let inParallel: string | null = null
      for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
        if ((parallelConfig as any).nodes.includes(block.id)) {
          inParallel = parallelId
          break
        }
      }

      if (inParallel) {
        // Expand parallel block into N branches
        const parallelConfig = dag.parallelConfigs.get(inParallel) as any
        
        logger.debug('Expanding parallel:', {
          parallelId: inParallel,
          config: parallelConfig,
        })
        
        let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []
        
        // Parse if string
        if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
          try {
            distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
          } catch (e) {
            logger.error('Failed to parse parallel distribution:', distributionItems)
            distributionItems = []
          }
        }
        
        // For collection-type parallels, count = distribution.length
        let count = parallelConfig.parallelCount || parallelConfig.count || 1
        if (parallelConfig.parallelType === 'collection' && Array.isArray(distributionItems)) {
          count = distributionItems.length
        }

        logger.debug('Creating parallel branches:', {
          parallelId: inParallel,
          count,
          parsedDistributionItems: distributionItems,
          distributionItemsLength: Array.isArray(distributionItems) ? distributionItems.length : 0,
        })

        for (let branchIndex = 0; branchIndex < count; branchIndex++) {
          const branchNodeId = `${block.id}₍${branchIndex}₎`

          dag.nodes.set(branchNodeId, {
            id: branchNodeId,
            block: { ...block },
            incomingEdges: new Set(),
            outgoingEdges: new Map(),
            metadata: {
              isParallelBranch: true,
              branchIndex,
              branchTotal: count,
              distributionItem: distributionItems[branchIndex],
            },
          })
        }
      } else {
        // Regular block or loop block (not expanded)
        const isLoopNode = blocksInLoops.has(block.id)
        let loopId: string | undefined

        if (isLoopNode) {
          for (const [lid, lconfig] of dag.loopConfigs) {
            if ((lconfig as any).nodes.includes(block.id)) {
              loopId = lid
              break
            }
          }
        }

        dag.nodes.set(block.id, {
          id: block.id,
          block,
          incomingEdges: new Set(),
          outgoingEdges: new Map(),
          metadata: {
            isLoopNode,
            loopId,
          },
        })
      }
    }

    // Step 4: Add edges (expand for parallels, add backwards-edges for loops)
    this.addEdges(workflow, dag, blocksInParallels, blocksInLoops)

    logger.info('DAG built', {
      totalNodes: dag.nodes.size,
      loopCount: dag.loopConfigs.size,
      parallelCount: dag.parallelConfigs.size,
    })

    return dag
  }

  private addEdges(
    workflow: SerializedWorkflow,
    dag: DAG,
    blocksInParallels: Set<string>,
    blocksInLoops: Set<string>
  ) {
    // Build map of loop block IDs
    const loopBlockIds = new Set(dag.loopConfigs.keys())
    const parallelBlockIds = new Set(dag.parallelConfigs.keys())

    for (const connection of workflow.connections) {
      let { source, target, sourceHandle, targetHandle } = connection

      // Skip edges involving loop/parallel blocks - we'll handle them specially
      const sourceIsLoopBlock = loopBlockIds.has(source)
      const targetIsLoopBlock = loopBlockIds.has(target)
      const sourceIsParallelBlock = parallelBlockIds.has(source)
      const targetIsParallelBlock = parallelBlockIds.has(target)

      if (sourceIsLoopBlock || targetIsLoopBlock || sourceIsParallelBlock || targetIsParallelBlock) {
        // Handle loop/parallel edges specially
        if (sourceIsLoopBlock) {
          // Edge FROM loop block
          const loopConfig = dag.loopConfigs.get(source) as any
          const loopNodes = loopConfig.nodes || []
          const isTargetInLoop = loopNodes.includes(target)
          
          if (sourceHandle?.includes('start')) {
            // Loop start edges - these go TO loop nodes (internal wiring)
            logger.debug('Skipping loop start internal edge:', { sourceHandle, target })
            continue // Skip - we handle loop entry via regular edges
          }
          
          if (sourceHandle?.includes('end') && isTargetInLoop) {
            // Loop end edge pointing back INTO the loop (internal wiring)
            logger.debug('Skipping loop end internal edge:', { sourceHandle, target })
            continue // Skip internal loop wiring  
          }
          
          // This is a loop EXIT edge (loop → external block)
          // Redirect from last node in loop
          const lastNode = loopConfig.nodes[loopConfig.nodes.length - 1]
          logger.debug('Redirecting loop exit edge:', {
            originalSource: source,
            redirectedFrom: lastNode,
            targetNode: target,
            sourceHandle,
          })
          source = lastNode // Redirect exit edge
        }

        if (targetIsLoopBlock) {
          // Edge TO loop block (entry edge) → redirect to first node in loop
          // Skip internal loop edges
          if (targetHandle?.includes('end') || targetHandle?.includes('loop')) {
            logger.debug('Skipping loop internal edge:', { targetHandle })
            continue // Skip internal loop wiring
          }
          
          const loopConfig = dag.loopConfigs.get(target) as any
          const firstNode = loopConfig.nodes[0]
          logger.debug('Redirecting loop entry edge:', {
            originalTarget: target,
            redirectedTo: firstNode,
            sourceNode: source,
          })
          target = firstNode // Redirect entry edge
        }

        if (sourceIsParallelBlock) {
          // Skip - parallels are expanded, not blocks
          continue
        }

        if (targetIsParallelBlock) {
          // Skip - parallels are expanded, not blocks
          continue
        }
      }

      // Determine if source/target are in parallels
      const sourceInParallel = blocksInParallels.has(source)
      const targetInParallel = blocksInParallels.has(target)

      if (sourceInParallel && targetInParallel) {
        // Both in parallel - need to check if same parallel
        const sourceParallelId = this.getParallelId(source, dag)
        const targetParallelId = this.getParallelId(target, dag)

        if (sourceParallelId === targetParallelId) {
          // Same parallel - expand edge across all branches
          const parallelConfig = dag.parallelConfigs.get(sourceParallelId!) as any
          const count = parallelConfig.parallelCount || parallelConfig.count || 1

          for (let i = 0; i < count; i++) {
            const sourceNodeId = `${source}₍${i}₎`
            const targetNodeId = `${target}₍${i}₎`
            this.addEdge(dag, sourceNodeId, targetNodeId, sourceHandle, targetHandle)
          }
        } else {
          // Different parallels - shouldn't happen in valid workflows
          logger.warn('Edge between different parallels:', { source, target })
        }
      } else if (sourceInParallel) {
        // Source in parallel, target outside - edge from ALL branches to target
        const sourceParallelId = this.getParallelId(source, dag)
        const parallelConfig = dag.parallelConfigs.get(sourceParallelId!) as any
        const count = parallelConfig.parallelCount || parallelConfig.count || 1

        for (let i = 0; i < count; i++) {
          const sourceNodeId = `${source}₍${i}₎`
          this.addEdge(dag, sourceNodeId, target, sourceHandle, targetHandle)
        }
      } else if (targetInParallel) {
        // Source outside, target in parallel - edge from source to ALL branches
        const targetParallelId = this.getParallelId(target, dag)
        const parallelConfig = dag.parallelConfigs.get(targetParallelId!) as any
        const count = parallelConfig.parallelCount || parallelConfig.count || 1

        for (let i = 0; i < count; i++) {
          const targetNodeId = `${target}₍${i}₎`
          this.addEdge(dag, source, targetNodeId, sourceHandle, targetHandle)
        }
      } else {
        // Regular edge
        this.addEdge(dag, source, target, sourceHandle, targetHandle)
      }
    }

    // Add backwards-edges for loops
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const config = loopConfig as any
      const nodes = config.nodes || []

      if (nodes.length > 0) {
        const firstNode = nodes[0]
        const lastNode = nodes[nodes.length - 1]

        logger.debug('Adding loop backwards-edge:', {
          loopId,
          from: lastNode,
          to: firstNode,
          loopType: config.loopType,
          iterations: config.iterations,
        })

        // Add backwards-edge from last to first (cycle!)
        this.addEdge(dag, lastNode, firstNode, 'loop_continue', undefined, true)
      }
    }
  }

  private addEdge(
    dag: DAG,
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string,
    isLoopBackEdge = false
  ) {
    const sourceNode = dag.nodes.get(sourceId)
    const targetNode = dag.nodes.get(targetId)

    if (!sourceNode || !targetNode) {
      logger.warn('Edge references non-existent node:', { sourceId, targetId })
      return
    }

    const edgeId = `${sourceId}→${targetId}`

    sourceNode.outgoingEdges.set(edgeId, {
      target: targetId,
      sourceHandle,
      targetHandle,
      isActive: isLoopBackEdge ? false : undefined, // Loop back-edges start inactive
    })

    // Only add to incoming edges if not a loop back-edge (those don't count for initial ready state)
    if (!isLoopBackEdge) {
      targetNode.incomingEdges.add(sourceId)
      logger.debug('Added incoming edge:', { from: sourceId, to: targetId })
    } else {
      logger.debug('Skipped adding backwards-edge to incomingEdges:', { from: sourceId, to: targetId })
    }
  }

  private getParallelId(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if ((parallelConfig as any).nodes.includes(blockId)) {
        return parallelId
      }
    }
    return null
  }

  /**
   * Find all blocks reachable from the start/trigger block
   * Uses BFS to traverse the connection graph
   */
  private findReachableBlocks(workflow: SerializedWorkflow, startBlockId?: string): Set<string> {
    const reachable = new Set<string>()
    
    // Find the start block
    let start = startBlockId
    if (!start) {
      // Find a trigger block (any block with no incoming connections)
      const blockIds = new Set(workflow.blocks.map(b => b.id))
      const hasIncoming = new Set(workflow.connections.map(c => c.target))
      
      for (const block of workflow.blocks) {
        if (!hasIncoming.has(block.id) && block.enabled) {
          start = block.id
          break
        }
      }
    }

    if (!start) {
      logger.warn('No start block found, including all blocks')
      return new Set(workflow.blocks.filter(b => b.enabled).map(b => b.id))
    }

    // BFS traversal from start
    const queue = [start]
    reachable.add(start)

    // Build adjacency map (initially only with explicit connections)
    const adjacency = new Map<string, string[]>()
    for (const conn of workflow.connections) {
      if (!adjacency.has(conn.source)) {
        adjacency.set(conn.source, [])
      }
      adjacency.get(conn.source)!.push(conn.target)
    }

    // First pass: traverse explicit connections to find reachable loop/parallel blocks
    const tempQueue = [start]
    const tempReachable = new Set([start])
    const reachableLoopBlocks = new Set<string>()
    const reachableParallelBlocks = new Set<string>()

    while (tempQueue.length > 0) {
      const current = tempQueue.shift()!
      const neighbors = adjacency.get(current) || []

      for (const neighbor of neighbors) {
        if (!tempReachable.has(neighbor)) {
          tempReachable.add(neighbor)
          tempQueue.push(neighbor)
          
          // Track if this is a loop or parallel block
          if (workflow.loops && (workflow.loops as any)[neighbor]) {
            reachableLoopBlocks.add(neighbor)
          }
          if (workflow.parallels && (workflow.parallels as any)[neighbor]) {
            reachableParallelBlocks.add(neighbor)
          }
        }
      }
    }

    // Add loop/parallel internal nodes to adjacency only if the loop/parallel block itself is reachable
    if (workflow.loops) {
      for (const [loopId, loopConfig] of Object.entries(workflow.loops)) {
        // Only add internal connections if this loop block is reachable
        if (reachableLoopBlocks.has(loopId)) {
          const nodes = (loopConfig as any).nodes || []
          // Add connections within loop
          for (let i = 0; i < nodes.length - 1; i++) {
            if (!adjacency.has(nodes[i])) {
              adjacency.set(nodes[i], [])
            }
            adjacency.get(nodes[i])!.push(nodes[i + 1])
          }
          
          // Loop block itself connects to first node
          if (nodes.length > 0) {
            if (!adjacency.has(loopId)) {
              adjacency.set(loopId, [])
            }
            adjacency.get(loopId)!.push(nodes[0])
          }
        }
      }
    }

    // Second pass: complete BFS traversal with all valid connections
    const finalQueue = [start]
    reachable.clear()
    reachable.add(start)

    // Traverse
    while (finalQueue.length > 0) {
      const current = finalQueue.shift()!
      const neighbors = adjacency.get(current) || []

      for (const neighbor of neighbors) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor)
          finalQueue.push(neighbor)
        }
      }
    }

    logger.debug('Reachable blocks after filtering:', {
      reachableLoops: Array.from(reachableLoopBlocks),
      reachableParallels: Array.from(reachableParallelBlocks),
    })

    return reachable
  }
}

