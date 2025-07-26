import { calculateHierarchicalLayout } from '@/lib/autolayout/algorithms/hierarchical'
import type { LayoutEdge, LayoutNode, LayoutOptions, LayoutResult } from '@/lib/autolayout/types'

interface WorkflowAnalysis {
  nodeCount: number
  edgeCount: number
  maxDepth: number
  branchingFactor: number
  hasParallelPaths: boolean
  hasLoops: boolean
  complexity: 'simple' | 'medium' | 'complex'
  recommendedStrategy: 'hierarchical' | 'layered' | 'force-directed'
  recommendedDirection: 'horizontal' | 'vertical'
}

/**
 * Smart layout algorithm that analyzes the workflow and chooses the optimal layout strategy
 */
export function calculateSmartLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  const TIMEOUT_MS = 5000 // 5 second timeout
  const startTime = Date.now()

  const checkTimeout = () => {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error('Layout calculation timeout - falling back to simple positioning')
    }
  }

  try {
    // Step 1: Analyze the workflow structure
    checkTimeout()
    const analysis = analyzeWorkflow(nodes, edges)

    // Step 2: Choose optimal strategy and direction
    checkTimeout()
    const optimizedOptions: LayoutOptions = {
      ...options,
      strategy: analysis.recommendedStrategy,
      direction: options.direction === 'auto' ? analysis.recommendedDirection : options.direction,
      spacing: optimizeSpacing(analysis, options.spacing),
    }

    // Step 3: Apply the chosen strategy
    checkTimeout()
    let result: LayoutResult

    switch (analysis.recommendedStrategy) {
      case 'hierarchical':
        result = calculateHierarchicalLayout(nodes, edges, optimizedOptions)
        break
      case 'layered':
        result = calculateLayeredLayout(nodes, edges, optimizedOptions)
        break
      case 'force-directed':
        result = calculateForceDirectedLayout(nodes, edges, optimizedOptions)
        break
      default:
        result = calculateHierarchicalLayout(nodes, edges, optimizedOptions)
    }

    // Step 4: Apply post-processing optimizations
    checkTimeout()
    result = applyPostProcessingOptimizations(result, nodes, edges, analysis)

    // Step 5: Update metadata
    result.metadata.strategy = 'smart'

    return result
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      // Fallback to simple grid layout on timeout
      return createFallbackLayout(nodes, edges, options)
    }
    throw error
  }
}

/**
 * Fallback layout for when smart layout times out or fails
 */
function createFallbackLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  const positions: Array<{ id: string; position: { x: number; y: number } }> = []

  // Simple grid layout
  const cols = Math.ceil(Math.sqrt(nodes.length))
  const spacing = 400

  nodes.forEach((node, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols

    positions.push({
      id: node.id,
      position: {
        x: col * spacing + (options.padding?.x || 200),
        y: row * spacing + (options.padding?.y || 200),
      },
    })
  })

  const maxX = Math.max(...positions.map((p) => p.position.x))
  const maxY = Math.max(...positions.map((p) => p.position.y))

  return {
    nodes: positions,
    metadata: {
      strategy: 'fallback-grid',
      totalWidth: maxX + 400,
      totalHeight: maxY + 200,
      layerCount: Math.ceil(nodes.length / cols),
      stats: {
        crossings: 0,
        totalEdgeLength: 0,
        nodeOverlaps: 0,
      },
    },
  }
}

function analyzeWorkflow(nodes: LayoutNode[], edges: LayoutEdge[]): WorkflowAnalysis {
  const nodeCount = nodes.length
  const edgeCount = edges.length

  // Build adjacency lists for analysis
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()

  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    if (!incoming.has(edge.target)) incoming.set(edge.target, [])
    outgoing.get(edge.source)!.push(edge.target)
    incoming.get(edge.target)!.push(edge.source)
  })

  // Calculate max depth using BFS
  const maxDepth = calculateMaxDepth(nodes, edges, outgoing)

  // Calculate average branching factor
  const branchingFactors = Array.from(outgoing.values()).map((targets) => targets.length)
  const avgBranchingFactor =
    branchingFactors.length > 0
      ? branchingFactors.reduce((a, b) => a + b, 0) / branchingFactors.length
      : 0

  // Detect parallel paths
  const hasParallelPaths = detectParallelPaths(nodes, edges, outgoing)

  // Detect loops/cycles (simplified check)
  const hasLoops = nodes.some((node) => node.type === 'loop' || node.isContainer)

  // Determine complexity
  let complexity: WorkflowAnalysis['complexity']
  if (nodeCount <= 5 && edgeCount <= 6 && maxDepth <= 3) {
    complexity = 'simple'
  } else if (nodeCount <= 15 && edgeCount <= 20 && maxDepth <= 6) {
    complexity = 'medium'
  } else {
    complexity = 'complex'
  }

  // Choose optimal strategy based on analysis
  let recommendedStrategy: WorkflowAnalysis['recommendedStrategy']
  let recommendedDirection: WorkflowAnalysis['recommendedDirection']

  if (complexity === 'simple' && !hasParallelPaths) {
    recommendedStrategy = 'hierarchical'
    recommendedDirection = avgBranchingFactor < 1.5 ? 'horizontal' : 'vertical'
  } else if (hasParallelPaths || avgBranchingFactor > 2) {
    recommendedStrategy = 'layered'
    recommendedDirection = 'vertical'
  } else if (complexity === 'complex' && !hasLoops) {
    recommendedStrategy = 'force-directed'
    recommendedDirection = 'horizontal'
  } else {
    recommendedStrategy = 'hierarchical'
    recommendedDirection = maxDepth > 4 ? 'vertical' : 'horizontal'
  }

  // Consider user preferences from nodes
  const horizontalPreference = nodes.filter((n) => n.horizontalHandles).length
  const verticalPreference = nodes.length - horizontalPreference

  if (horizontalPreference > verticalPreference * 1.5) {
    recommendedDirection = 'horizontal'
  } else if (verticalPreference > horizontalPreference * 1.5) {
    recommendedDirection = 'vertical'
  }

  return {
    nodeCount,
    edgeCount,
    maxDepth,
    branchingFactor: avgBranchingFactor,
    hasParallelPaths,
    hasLoops,
    complexity,
    recommendedStrategy,
    recommendedDirection,
  }
}

function calculateMaxDepth(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  outgoing: Map<string, string[]>
): number {
  const visited = new Set<string>()
  const visiting = new Set<string>() // Track nodes currently being visited to detect cycles
  let maxDepth = 0

  // Find root nodes
  const roots = nodes.filter(
    (node) => !edges.some((edge) => edge.target === node.id) || node.category === 'trigger'
  )

  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0])
  }

  // DFS to find maximum depth with cycle detection
  function dfs(nodeId: string, depth: number): number {
    if (visiting.has(nodeId)) {
      // Cycle detected, return current depth to avoid infinite loop
      return depth
    }
    if (visited.has(nodeId)) return depth

    visiting.add(nodeId)
    visited.add(nodeId)

    let localMaxDepth = depth
    const children = outgoing.get(nodeId) || []

    for (const childId of children) {
      const childDepth = dfs(childId, depth + 1)
      localMaxDepth = Math.max(localMaxDepth, childDepth)
    }

    visiting.delete(nodeId)
    return localMaxDepth
  }

  for (const root of roots) {
    const rootDepth = dfs(root.id, 0)
    maxDepth = Math.max(maxDepth, rootDepth)
  }

  return maxDepth
}

function detectParallelPaths(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  outgoing: Map<string, string[]>
): boolean {
  // Quick check - look for nodes that have multiple outgoing edges
  const nodesWithMultipleOutputs = Array.from(outgoing.entries()).filter(
    ([_, targets]) => targets.length > 1
  )

  // If there are too many to check efficiently, just return true (assume parallel paths exist)
  if (nodesWithMultipleOutputs.length > 10) {
    return true
  }

  for (const [nodeId, targets] of nodesWithMultipleOutputs) {
    // Quick heuristic - if targets have different types, they're likely parallel paths
    const targetNodes = targets
      .map((targetId) => nodes.find((n) => n.id === targetId))
      .filter((n): n is LayoutNode => n !== undefined)
    const uniqueCategories = new Set(targetNodes.map((n) => n.category))

    if (uniqueCategories.size > 1) {
      return true // Different categories suggest parallel processing paths
    }

    // Only do expensive convergence check for simple cases
    if (targets.length <= 3) {
      if (hasConvergingPaths(targets, outgoing, new Set())) {
        return true
      }
    }
  }
  return false
}

function hasConvergingPaths(
  startNodes: string[],
  outgoing: Map<string, string[]>,
  visited: Set<string>
): boolean {
  // Early exit for simple cases
  if (startNodes.length <= 1) return false

  const MAX_DEPTH = 10 // Limit traversal depth to prevent infinite loops
  const paths = new Map<string, Set<string>>()

  // Trace each path with depth limit
  startNodes.forEach((startNode, index) => {
    const pathNodes = new Set<string>()
    const queue: Array<{ node: string; depth: number }> = [{ node: startNode, depth: 0 }]
    const pathVisited = new Set<string>()

    while (queue.length > 0) {
      const { node: current, depth } = queue.shift()!

      if (pathVisited.has(current) || depth > MAX_DEPTH) continue
      pathVisited.add(current)
      pathNodes.add(current)

      const children = outgoing.get(current) || []
      children.forEach((childId) => {
        if (!pathVisited.has(childId)) {
          queue.push({ node: childId, depth: depth + 1 })
        }
      })
    }

    paths.set(`path-${index}`, pathNodes)
  })

  // Optimized convergence check - early exit on first intersection
  const pathSets = Array.from(paths.values())
  for (let i = 0; i < pathSets.length; i++) {
    for (let j = i + 1; j < pathSets.length; j++) {
      // Quick check - any common node?
      for (const node of pathSets[i]) {
        if (pathSets[j].has(node)) {
          return true
        }
      }
    }
  }

  return false
}

function optimizeSpacing(
  analysis: WorkflowAnalysis,
  baseSpacing: LayoutOptions['spacing']
): LayoutOptions['spacing'] {
  const { complexity, nodeCount, branchingFactor } = analysis

  let multiplier = 1

  // Adjust spacing based on complexity
  switch (complexity) {
    case 'simple':
      multiplier = 0.8
      break
    case 'medium':
      multiplier = 1.0
      break
    case 'complex':
      multiplier = 1.2
      break
  }

  // Adjust for node count
  if (nodeCount > 20) multiplier *= 1.1
  if (nodeCount > 50) multiplier *= 1.2

  // Adjust for branching factor
  if (branchingFactor > 3) multiplier *= 1.15

  return {
    horizontal: Math.round(baseSpacing.horizontal * multiplier),
    vertical: Math.round(baseSpacing.vertical * multiplier),
    layer: Math.round(baseSpacing.layer * multiplier),
  }
}

// Simplified layered layout for medium complexity workflows
function calculateLayeredLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  // For now, delegate to hierarchical layout with adjusted spacing
  const adjustedOptions = {
    ...options,
    spacing: {
      ...options.spacing,
      vertical: options.spacing.vertical * 1.2,
      layer: options.spacing.layer * 0.9,
    },
  }

  return calculateHierarchicalLayout(nodes, edges, adjustedOptions)
}

// Simplified force-directed layout for complex workflows
function calculateForceDirectedLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  // For now, use a simplified force-directed approach
  const positions: Array<{ id: string; position: { x: number; y: number } }> = []

  // Start with hierarchical layout as base
  const hierarchicalResult = calculateHierarchicalLayout(nodes, edges, options)

  // Apply some force-directed adjustments
  const nodePositions = new Map(hierarchicalResult.nodes.map((n) => [n.id, n.position]))

  // Simple force simulation (simplified)
  const iterations = 10
  const edgeLength = options.spacing.layer

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { x: number; y: number }>()

    // Initialize forces
    nodes.forEach((node) => {
      forces.set(node.id, { x: 0, y: 0 })
    })

    // Attractive forces along edges
    edges.forEach((edge) => {
      const sourcePos = nodePositions.get(edge.source)
      const targetPos = nodePositions.get(edge.target)

      if (sourcePos && targetPos) {
        const dx = targetPos.x - sourcePos.x
        const dy = targetPos.y - sourcePos.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance > 0) {
          const force = (distance - edgeLength) * 0.1
          const fx = (dx / distance) * force
          const fy = (dy / distance) * force

          const sourceForce = forces.get(edge.source)!
          const targetForce = forces.get(edge.target)!

          sourceForce.x += fx
          sourceForce.y += fy
          targetForce.x -= fx
          targetForce.y -= fy
        }
      }
    })

    // Apply forces with damping
    nodes.forEach((node) => {
      const pos = nodePositions.get(node.id)!
      const force = forces.get(node.id)!

      pos.x += force.x * 0.5
      pos.y += force.y * 0.5
    })
  }

  // Convert back to result format
  nodePositions.forEach((position, id) => {
    positions.push({ id, position })
  })

  return {
    nodes: positions,
    metadata: {
      ...hierarchicalResult.metadata,
      strategy: 'force-directed',
    },
  }
}

function applyPostProcessingOptimizations(
  result: LayoutResult,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  analysis: WorkflowAnalysis
): LayoutResult {
  // Apply alignment improvements
  result = improveAlignment(result, nodes, analysis)

  // Apply spacing optimizations
  result = optimizeNodeSpacing(result, nodes, edges)

  // Apply aesthetic improvements
  result = improveAesthetics(result, nodes, edges)

  return result
}

function improveAlignment(
  result: LayoutResult,
  nodes: LayoutNode[],
  analysis: WorkflowAnalysis
): LayoutResult {
  // For simple workflows, ensure better alignment of key nodes
  if (analysis.complexity === 'simple') {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const positions = new Map(result.nodes.map((n) => [n.id, n.position]))

    // Align trigger nodes
    const triggerNodes = result.nodes.filter((n) => {
      const node = nodeMap.get(n.id)
      return node?.category === 'trigger'
    })

    if (triggerNodes.length > 1) {
      const avgY = triggerNodes.reduce((sum, n) => sum + n.position.y, 0) / triggerNodes.length
      triggerNodes.forEach((n) => {
        n.position.y = avgY
      })
    }
  }

  return result
}

function optimizeNodeSpacing(
  result: LayoutResult,
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): LayoutResult {
  // Ensure minimum spacing between nodes
  const minSpacing = 50
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  result.nodes.forEach((nodeA, i) => {
    result.nodes.forEach((nodeB, j) => {
      if (i >= j) return

      const nodeAData = nodeMap.get(nodeA.id)
      const nodeBData = nodeMap.get(nodeB.id)

      if (!nodeAData || !nodeBData) return

      const dx = nodeB.position.x - nodeA.position.x
      const dy = nodeB.position.y - nodeA.position.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      const requiredDistance = (nodeAData.width + nodeBData.width) / 2 + minSpacing

      if (distance > 0 && distance < requiredDistance) {
        const adjustmentFactor = (requiredDistance - distance) / distance / 2
        const adjustX = dx * adjustmentFactor
        const adjustY = dy * adjustmentFactor

        nodeA.position.x -= adjustX
        nodeA.position.y -= adjustY
        nodeB.position.x += adjustX
        nodeB.position.y += adjustY
      }
    })
  })

  return result
}

function improveAesthetics(
  result: LayoutResult,
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): LayoutResult {
  // Center the layout around origin
  const positions = result.nodes.map((n) => n.position)
  const minX = Math.min(...positions.map((p) => p.x))
  const minY = Math.min(...positions.map((p) => p.y))
  const maxX = Math.max(...positions.map((p) => p.x))
  const maxY = Math.max(...positions.map((p) => p.y))

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  result.nodes.forEach((node) => {
    node.position.x -= centerX
    node.position.y -= centerY
  })

  // Update metadata
  result.metadata.totalWidth = maxX - minX
  result.metadata.totalHeight = maxY - minY

  return result
}
