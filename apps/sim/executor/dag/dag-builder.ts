import { createLogger } from '@/lib/logs/console/logger'
import type { 
  SerializedWorkflow, 
  SerializedBlock, 
  SerializedLoop, 
  SerializedParallel 
} from '@/serializer/types'
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

    // Step 2.5: Create sentinel nodes for loops (only for reachable loops)
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const config = loopConfig as any
      const nodes = config.nodes || []
      
      if (nodes.length === 0) continue
      
      // Only create sentinels if at least one node in the loop is reachable
      const hasReachableNodes = nodes.some((nodeId: string) => reachableBlocks.has(nodeId))
      if (!hasReachableNodes) {
        logger.debug('Skipping sentinel creation for unreachable loop', { loopId })
        continue
      }

      // Create sentinel_start node
      const sentinelStartId = `loop-${loopId}-sentinel-start`
      dag.nodes.set(sentinelStartId, {
        id: sentinelStartId,
        block: {
          id: sentinelStartId,
          enabled: true,
          metadata: {
            id: 'sentinel_start',
            name: `Loop Start (${loopId})`,
            loopId,
          },
          config: { params: {} },
        } as any,
        incomingEdges: new Set(),
        outgoingEdges: new Map(),
        metadata: {
          isSentinel: true,
          sentinelType: 'start',
          loopId,
        },
      })

      // Create sentinel_end node
      const sentinelEndId = `loop-${loopId}-sentinel-end`
      dag.nodes.set(sentinelEndId, {
        id: sentinelEndId,
        block: {
          id: sentinelEndId,
          enabled: true,
          metadata: {
            id: 'sentinel_end',
            name: `Loop End (${loopId})`,
            loopId,
          },
          config: { params: {} },
        } as any,
        incomingEdges: new Set(),
        outgoingEdges: new Map(),
        metadata: {
          isSentinel: true,
          sentinelType: 'end',
          loopId,
        },
      })

      logger.debug('Created sentinel nodes for loop', {
        loopId,
        sentinelStartId,
        sentinelEndId,
        loopNodes: nodes,
      })
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
    // Only create edges for reachable blocks
    this.addEdges(workflow, dag, blocksInParallels, blocksInLoops, reachableBlocks)

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
    blocksInLoops: Set<string>,
    reachableBlocks: Set<string>
  ) {
    // Build map of loop block IDs
    const loopBlockIds = new Set(dag.loopConfigs.keys())
    const parallelBlockIds = new Set(dag.parallelConfigs.keys())

    // Build a map of block types for quick lookup
    const blockTypeMap = new Map<string, string>()
    for (const block of workflow.blocks) {
      blockTypeMap.set(block.id, block.metadata?.id || '')
    }

    // Build a map of condition block configurations for sourceHandle generation
    const conditionConfigMap = new Map<string, any[]>()
    const routerBlockIds = new Set<string>()
    
    for (const block of workflow.blocks) {
      if (block.metadata?.id === 'condition') {
        try {
          const conditionsJson = block.config.params?.conditions
          if (typeof conditionsJson === 'string') {
            const conditions = JSON.parse(conditionsJson)
            conditionConfigMap.set(block.id, conditions)
          } else if (Array.isArray(conditionsJson)) {
            conditionConfigMap.set(block.id, conditionsJson)
          }
        } catch (error) {
          logger.warn('Failed to parse condition config:', { blockId: block.id })
        }
      } else if (block.metadata?.id === 'router') {
        routerBlockIds.add(block.id)
      }
    }

    for (const connection of workflow.connections) {
      let { source, target, sourceHandle, targetHandle } = connection

      // Generate sourceHandle for condition blocks if not provided
      if (!sourceHandle && blockTypeMap.get(source) === 'condition') {
        const conditions = conditionConfigMap.get(source)
        if (conditions && conditions.length > 0) {
          // Get all edges from this condition block
          const edgesFromCondition = workflow.connections.filter((c) => c.source === source)
          
          // Find which index this target is in the edges from this condition
          const edgeIndex = edgesFromCondition.findIndex((e) => e.target === target)
          
          // Use the condition at the same index
          if (edgeIndex >= 0 && edgeIndex < conditions.length) {
            const correspondingCondition = conditions[edgeIndex]
            sourceHandle = `condition-${correspondingCondition.id}`
          }
        }
      }

      // Generate sourceHandle for router blocks if not provided
      // Router edges use the target block ID as the route identifier
      if (!sourceHandle && routerBlockIds.has(source)) {
        sourceHandle = `router-${target}`
        logger.debug('Generated router sourceHandle:', {
          source,
          target,
          sourceHandle,
        })
      }

      // ALWAYS ensure router blocks have the correct sourceHandle format
      if (routerBlockIds.has(source)) {
        sourceHandle = `router-${target}`
        logger.debug('Set router sourceHandle:', {
          source,
          target,
          sourceHandle,
        })
      }

      // Skip edges involving loop/parallel blocks - we'll handle them specially
      const sourceIsLoopBlock = loopBlockIds.has(source)
      const targetIsLoopBlock = loopBlockIds.has(target)
      const sourceIsParallelBlock = parallelBlockIds.has(source)
      const targetIsParallelBlock = parallelBlockIds.has(target)

      if (sourceIsLoopBlock || targetIsLoopBlock || sourceIsParallelBlock || targetIsParallelBlock) {
        // Handle loop/parallel edges specially
        if (sourceIsLoopBlock) {
          // Edge FROM loop block → redirect to sentinel_end
          const sentinelEndId = `loop-${source}-sentinel-end`
          
          // Verify sentinel exists (loop is reachable)
          if (!dag.nodes.has(sentinelEndId)) {
            logger.debug('Skipping loop exit edge - sentinel not found (unreachable loop)', {
              source,
              target,
            })
            continue
          }
          
          logger.debug('Redirecting loop exit edge to sentinel_end:', {
            originalSource: source,
            redirectedFrom: sentinelEndId,
            targetNode: target,
            sourceHandle: 'loop_exit',
          })
          
          // Redirect to sentinel_end with 'loop_exit' handle
          source = sentinelEndId
          sourceHandle = 'loop_exit'
        }

        if (targetIsLoopBlock) {
          // Edge TO loop block → redirect to sentinel_start
          const sentinelStartId = `loop-${target}-sentinel-start`
          
          // Verify sentinel exists (loop is reachable)
          if (!dag.nodes.has(sentinelStartId)) {
            logger.debug('Skipping loop entry edge - sentinel not found (unreachable loop)', {
              source,
              target,
            })
            continue
          }
          
          logger.debug('Redirecting loop entry edge to sentinel_start:', {
            originalTarget: target,
            redirectedTo: sentinelStartId,
            sourceNode: source,
          })
          
          // Redirect to sentinel_start
          target = sentinelStartId
        }

        if (sourceIsParallelBlock) {
          // Edge FROM parallel block → handle later after all internal edges are built
          // Store these edges for post-processing
          continue
        }

        if (targetIsParallelBlock) {
          // Edge TO parallel block → handle later after all internal edges are built
          // Store these edges for post-processing
          continue
        }
      }
      
      // Check if source/target are in loops (for sentinel routing)
      const sourceInLoop = blocksInLoops.has(source)
      const targetInLoop = blocksInLoops.has(target)
      let sourceLoopId: string | undefined
      let targetLoopId: string | undefined
      
      if (sourceInLoop) {
        for (const [loopId, loopConfig] of dag.loopConfigs) {
          if ((loopConfig as any).nodes.includes(source)) {
            sourceLoopId = loopId
            break
          }
        }
      }
      
      if (targetInLoop) {
        for (const [loopId, loopConfig] of dag.loopConfigs) {
          if ((loopConfig as any).nodes.includes(target)) {
            targetLoopId = loopId
            break
          }
        }
      }
      
      // If edge crosses loop boundary, skip it - sentinels will handle it
      if (sourceInLoop !== targetInLoop || sourceLoopId !== targetLoopId) {
        logger.debug('Skipping edge that crosses loop boundary - will be handled by sentinels', {
          source,
          target,
          sourceInLoop,
          targetInLoop,
          sourceLoopId,
          targetLoopId,
        })
        continue
      }
      
      // Check reachability AFTER loop/parallel redirects have been applied
      // This ensures edges to loop/parallel blocks are redirected to sentinels first
      // We check both reachableBlocks (original blocks) and dag.nodes (includes sentinels)
      if (!reachableBlocks.has(source) && !dag.nodes.has(source)) {
        logger.debug('Skipping edge - source not reachable', { source, target })
        continue
      }
      
      if (!reachableBlocks.has(target) && !dag.nodes.has(target)) {
        logger.debug('Skipping edge - target not reachable', { source, target })
        continue
      }

      // Determine if source/target are in parallels
      const sourceInParallel = blocksInParallels.has(source)
      const targetInParallel = blocksInParallels.has(target)

      if (sourceInParallel && targetInParallel) {
        // Both in parallel - need to check if same parallel
        const sourceParallelId = this.getParallelId(source, dag)
        const targetParallelId = this.getParallelId(target, dag)

        if (sourceParallelId === targetParallelId) {
          // Same parallel - expand edge across all branches (internal connection)
          const parallelConfig = dag.parallelConfigs.get(sourceParallelId!) as any
          
          // Calculate actual branch count (same logic as branch creation)
          let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []
          if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
            try {
              distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
            } catch (e) {
              distributionItems = []
            }
          }
          
          let count = parallelConfig.parallelCount || parallelConfig.count || 1
          if (parallelConfig.parallelType === 'collection' && Array.isArray(distributionItems)) {
            count = distributionItems.length
          }

          for (let i = 0; i < count; i++) {
            const sourceNodeId = `${source}₍${i}₎`
            const targetNodeId = `${target}₍${i}₎`
            this.addEdge(dag, sourceNodeId, targetNodeId, sourceHandle, targetHandle)
          }
        } else {
          // Different parallels - shouldn't happen in valid workflows
          logger.warn('Edge between different parallels - invalid workflow structure:', { source, target })
        }
      } else if (sourceInParallel || targetInParallel) {
        // Internal node connecting to external node - this violates parallel/loop semantics
        // These edges should be at the parallel block level, not internal node level
        // They will be handled by the parallel block wiring section
        logger.debug('Skipping internal-to-external edge (will be handled by parallel block wiring):', {
          source,
          target,
          sourceInParallel,
          targetInParallel,
        })
        continue
      } else {
        // Regular edge (both nodes outside any parallel/loop)
        this.addEdge(dag, source, target, sourceHandle, targetHandle)
      }
    }

    // Wire up sentinel nodes for loops
    // Process edges that cross loop boundaries through sentinels
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const config = loopConfig as any
      const nodes = config.nodes || []

      if (nodes.length === 0) continue
      
      const sentinelStartId = `loop-${loopId}-sentinel-start`
      const sentinelEndId = `loop-${loopId}-sentinel-end`
      
      // Skip if sentinel nodes don't exist (loop was unreachable)
      if (!dag.nodes.has(sentinelStartId) || !dag.nodes.has(sentinelEndId)) {
        logger.debug('Skipping sentinel wiring for unreachable loop', { loopId })
        continue
      }
      
      const nodesSet = new Set(nodes)
      const startNodesSet = new Set<string>()
      const terminalNodesSet = new Set<string>()

      // Find start nodes: nodes with no incoming edges from within the loop
      // Only consider nodes that exist in the DAG (are reachable)
      for (const nodeId of nodes) {
        const node = dag.nodes.get(nodeId)
        if (!node) continue // Skip unreachable nodes that weren't added to DAG
        
        let hasIncomingFromLoop = false
        for (const incomingNodeId of node.incomingEdges) {
          if (nodesSet.has(incomingNodeId)) {
            hasIncomingFromLoop = true
            break
          }
        }
        
        if (!hasIncomingFromLoop) {
          startNodesSet.add(nodeId)
        }
      }
      
      // Find terminal nodes: nodes with no outgoing edges to other loop nodes
      // Only consider nodes that exist in the DAG (are reachable)
      for (const nodeId of nodes) {
        const node = dag.nodes.get(nodeId)
        if (!node) continue // Skip unreachable nodes that weren't added to DAG
        
        let hasOutgoingToLoop = false
        for (const [_, edge] of node.outgoingEdges) {
          if (nodesSet.has(edge.target)) {
            hasOutgoingToLoop = true
            break
          }
        }
        
        if (!hasOutgoingToLoop) {
          terminalNodesSet.add(nodeId)
        }
      }
      
      const startNodes = Array.from(startNodesSet)
      const terminalNodes = Array.from(terminalNodesSet)

      logger.debug('Wiring sentinel nodes for loop', {
        loopId,
        startNodes,
        terminalNodes,
        totalNodes: nodes.length,
      })

      // Connect sentinel_start to all start nodes
      for (const startNodeId of startNodes) {
        this.addEdge(dag, sentinelStartId, startNodeId)
        logger.debug('Connected sentinel_start to start node', { from: sentinelStartId, to: startNodeId })
      }

      // Connect all terminal nodes to sentinel_end
      for (const terminalNodeId of terminalNodes) {
        this.addEdge(dag, terminalNodeId, sentinelEndId)
        logger.debug('Connected terminal node to sentinel_end', { from: terminalNodeId, to: sentinelEndId })
      }

      // Add backward edge from sentinel_end to sentinel_start (loop continue)
      this.addEdge(dag, sentinelEndId, sentinelStartId, 'loop_continue', undefined, true)
      logger.debug('Added backward edge', { from: sentinelEndId, to: sentinelStartId })
    }

    // Wire up parallel blocks
    // Process edges that cross parallel boundaries by connecting to entry/terminal nodes
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const config = parallelConfig as any
      const nodes = config.nodes || []

      if (nodes.length === 0) continue

      // Build a set of all nodes in this parallel for quick lookup
      const nodesSet = new Set(nodes)
      const entryNodesSet = new Set<string>()
      const terminalNodesSet = new Set<string>()

      // Find entry nodes: nodes with no incoming edges from within the parallel
      for (const nodeId of nodes) {
        // Check if any branch of this node exists in the DAG
        const branchCount = config.count || config.parallelCount || 1
        let hasAnyBranch = false
        for (let i = 0; i < branchCount; i++) {
          const branchNodeId = `${nodeId}₍${i}₎`
          if (dag.nodes.has(branchNodeId)) {
            hasAnyBranch = true
            break
          }
        }
        
        if (!hasAnyBranch) continue // Skip unreachable nodes

        // Check if this node has incoming edges from other nodes in the parallel
        // We check the first branch as a representative
        const firstBranchId = `${nodeId}₍0₎`
        const firstBranchNode = dag.nodes.get(firstBranchId)
        if (!firstBranchNode) continue

        let hasIncomingFromParallel = false
        for (const incomingNodeId of firstBranchNode.incomingEdges) {
          // Extract original node ID from branch ID
          const originalNodeId = incomingNodeId.includes('₍') 
            ? incomingNodeId.substring(0, incomingNodeId.indexOf('₍'))
            : incomingNodeId
          
          if (nodesSet.has(originalNodeId)) {
            hasIncomingFromParallel = true
            break
          }
        }

        if (!hasIncomingFromParallel) {
          entryNodesSet.add(nodeId)
        }
      }

      // Find terminal nodes: nodes with no outgoing edges to other nodes in the parallel
      for (const nodeId of nodes) {
        // Check if any branch of this node exists in the DAG
        const branchCount = config.count || config.parallelCount || 1
        let hasAnyBranch = false
        for (let i = 0; i < branchCount; i++) {
          const branchNodeId = `${nodeId}₍${i}₎`
          if (dag.nodes.has(branchNodeId)) {
            hasAnyBranch = true
            break
          }
        }
        
        if (!hasAnyBranch) continue // Skip unreachable nodes

        // Check if this node has outgoing edges to other nodes in the parallel
        // We check the first branch as a representative
        const firstBranchId = `${nodeId}₍0₎`
        const firstBranchNode = dag.nodes.get(firstBranchId)
        if (!firstBranchNode) continue

        let hasOutgoingToParallel = false
        for (const [_, edge] of firstBranchNode.outgoingEdges) {
          // Extract original node ID from branch ID
          const originalTargetId = edge.target.includes('₍')
            ? edge.target.substring(0, edge.target.indexOf('₍'))
            : edge.target
          
          if (nodesSet.has(originalTargetId)) {
            hasOutgoingToParallel = true
            break
          }
        }

        if (!hasOutgoingToParallel) {
          terminalNodesSet.add(nodeId)
        }
      }

      const entryNodes = Array.from(entryNodesSet)
      const terminalNodes = Array.from(terminalNodesSet)
      
      // Calculate actual branch count (same logic as branch creation)
      let distributionItems = config.distributionItems || config.distribution || []
      if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
        try {
          distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
        } catch (e) {
          distributionItems = []
        }
      }
      
      let branchCount = config.parallelCount || config.count || 1
      if (config.parallelType === 'collection' && Array.isArray(distributionItems)) {
        branchCount = distributionItems.length
      }

      logger.info('Wiring parallel block edges', {
        parallelId,
        entryNodes,
        terminalNodes,
        branchCount,
        totalNodes: nodes.length,
      })

      // Now process edges that target or source the parallel block
      for (const connection of workflow.connections) {
        const { source, target, sourceHandle, targetHandle } = connection

        // Edge TO parallel block: connect source to all branches of entry nodes
        if (target === parallelId) {
          // Skip if source is also a parallel/loop block (should have been filtered out)
          if (loopBlockIds.has(source) || parallelBlockIds.has(source)) {
            continue
          }

          // Skip if source is an internal node of this same parallel
          // (This represents an invalid workflow structure)
          if (nodesSet.has(source)) {
            logger.warn('Skipping invalid connection to parallel block from its own internal node', {
              parallelId,
              source,
            })
            continue
          }

          logger.info('Wiring edge to parallel block', {
            source,
            parallelId,
            entryNodes,
            branchCount,
          })

          for (const entryNodeId of entryNodes) {
            for (let i = 0; i < branchCount; i++) {
              const branchNodeId = `${entryNodeId}₍${i}₎`
              if (dag.nodes.has(branchNodeId)) {
                this.addEdge(dag, source, branchNodeId, sourceHandle, targetHandle)
                logger.debug('Connected to parallel entry branch', {
                  from: source,
                  to: branchNodeId,
                  branch: i,
                })
              }
            }
          }
        }

        // Edge FROM parallel block: connect all branches of terminal nodes to target
        if (source === parallelId) {
          // Skip if target is also a parallel/loop block (should have been filtered out)
          if (loopBlockIds.has(target) || parallelBlockIds.has(target)) {
            continue
          }

          // Skip if target is an internal node of this same parallel
          // (This represents an invalid workflow structure)
          if (nodesSet.has(target)) {
            logger.warn('Skipping invalid connection from parallel block to its own internal node', {
              parallelId,
              target,
            })
            continue
          }

          logger.info('Wiring edge from parallel block', {
            parallelId,
            target,
            terminalNodes,
            branchCount,
          })

          for (const terminalNodeId of terminalNodes) {
            for (let i = 0; i < branchCount; i++) {
              const branchNodeId = `${terminalNodeId}₍${i}₎`
              if (dag.nodes.has(branchNodeId)) {
                this.addEdge(dag, branchNodeId, target, sourceHandle, targetHandle)
                logger.debug('Connected from parallel terminal branch', {
                  from: branchNodeId,
                  to: target,
                  branch: i,
                })
              }
            }
          }
        }
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
   * Find all blocks reachable from a trigger block
   * Uses BFS to traverse the connection graph
   */
  private findReachableBlocks(workflow: SerializedWorkflow, startBlockId?: string): Set<string> {
    const reachable = new Set<string>()
    
    // Find a trigger block to start traversal from
    let triggerBlockId = startBlockId
    
    // Validate that startBlockId (if provided) is actually a trigger block
    if (triggerBlockId) {
      const triggerBlock = workflow.blocks.find(b => b.id === triggerBlockId)
      const blockType = triggerBlock?.metadata?.id
      const isTrigger = blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger'
      
      if (!isTrigger) {
        logger.warn('Provided startBlockId is not a trigger block, finding trigger automatically', {
          startBlockId: triggerBlockId,
          blockType,
        })
        triggerBlockId = undefined // Clear it and find a valid trigger
      }
    }
    
    if (!triggerBlockId) {
      // First priority: Find an explicit trigger block (start_trigger, starter, trigger)
      for (const block of workflow.blocks) {
        const blockType = block.metadata?.id
        if (
          block.enabled &&
          (blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger')
        ) {
          triggerBlockId = block.id
          logger.debug('Found trigger block for reachability traversal', { blockId: triggerBlockId, blockType })
          break
        }
      }
      
      // Second priority: Find a block with no incoming connections (but not loop/parallel blocks)
      if (!triggerBlockId) {
        const hasIncoming = new Set(workflow.connections.map(c => c.target))
        
        for (const block of workflow.blocks) {
          const blockType = block.metadata?.id
          if (
            !hasIncoming.has(block.id) && 
            block.enabled &&
            blockType !== 'loop' &&
            blockType !== 'parallel'
          ) {
            triggerBlockId = block.id
            logger.debug('Found block with no incoming connections as trigger', { blockId: triggerBlockId, blockType })
            break
          }
        }
      }
    }

    if (!triggerBlockId) {
      logger.warn('No trigger block found, including all enabled blocks')
      return new Set(workflow.blocks.filter(b => b.enabled).map(b => b.id))
    }
    
    logger.debug('Starting reachability traversal from trigger block', { triggerBlockId })

    // BFS traversal from trigger block
    const queue = [triggerBlockId]
    reachable.add(triggerBlockId)

    // Build adjacency map (initially only with explicit connections)
    const adjacency = new Map<string, string[]>()
    for (const conn of workflow.connections) {
      if (!adjacency.has(conn.source)) {
        adjacency.set(conn.source, [])
      }
      adjacency.get(conn.source)!.push(conn.target)
    }

    // First pass: traverse explicit connections to find reachable loop/parallel blocks
    const tempQueue = [triggerBlockId]
    const tempReachable = new Set([triggerBlockId])
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
    const finalQueue = [triggerBlockId]
    reachable.clear()
    reachable.add(triggerBlockId)

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

