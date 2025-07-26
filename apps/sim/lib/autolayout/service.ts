import { createLogger } from '@/lib/logs/console/logger'
import { calculateHierarchicalLayout } from './algorithms/hierarchical'
import { calculateSmartLayout } from './algorithms/smart'
import type { LayoutEdge, LayoutNode, LayoutOptions, LayoutResult, WorkflowGraph } from './types'
import { BLOCK_CATEGORIES, BLOCK_DIMENSIONS } from './types'

const logger = createLogger('AutoLayoutService')

/**
 * Main autolayout service for workflow blocks
 */
export class AutoLayoutService {
  private static instance: AutoLayoutService

  static getInstance(): AutoLayoutService {
    if (!AutoLayoutService.instance) {
      AutoLayoutService.instance = new AutoLayoutService()
    }
    return AutoLayoutService.instance
  }

  /**
   * Calculate optimal layout for workflow blocks, including nested blocks
   */
  async calculateLayout(
    workflowGraph: WorkflowGraph,
    options: Partial<LayoutOptions> = {}
  ): Promise<LayoutResult> {
    const startTime = Date.now()

    try {
      // Merge with default options
      const layoutOptions: LayoutOptions = {
        strategy: 'smart',
        direction: 'auto',
        spacing: {
          horizontal: 400,
          vertical: 200,
          layer: 600,
        },
        alignment: 'center',
        padding: {
          x: 200,
          y: 200,
        },
        ...options,
      }

      logger.info('Calculating layout with nested block support', {
        nodeCount: workflowGraph.nodes.length,
        edgeCount: workflowGraph.edges.length,
        strategy: layoutOptions.strategy,
        direction: layoutOptions.direction,
      })

      // Validate input
      this.validateWorkflowGraph(workflowGraph)

      // Calculate layout based on strategy
      let result: LayoutResult

      switch (layoutOptions.strategy) {
        case 'hierarchical':
          result = calculateHierarchicalLayout(
            workflowGraph.nodes,
            workflowGraph.edges,
            layoutOptions
          )
          break
        case 'smart':
          result = calculateSmartLayout(workflowGraph.nodes, workflowGraph.edges, layoutOptions)
          break
        default:
          logger.warn(`Unknown layout strategy: ${layoutOptions.strategy}, falling back to smart`)
          result = calculateSmartLayout(workflowGraph.nodes, workflowGraph.edges, layoutOptions)
      }

      const elapsed = Date.now() - startTime
      logger.info('Layout calculation completed', {
        strategy: result.metadata.strategy,
        nodeCount: result.nodes.length,
        totalWidth: result.metadata.totalWidth,
        totalHeight: result.metadata.totalHeight,
        layerCount: result.metadata.layerCount,
        elapsed: `${elapsed}ms`,
      })

      return result
    } catch (error) {
      const elapsed = Date.now() - startTime
      logger.error('Layout calculation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsed: `${elapsed}ms`,
        nodeCount: workflowGraph.nodes.length,
        edgeCount: workflowGraph.edges.length,
      })
      throw error
    }
  }

  /**
   * Convert workflow store blocks and edges to layout format with nested block support
   */
  convertWorkflowToGraph(blocks: Record<string, any>, edges: any[]): WorkflowGraph {
    try {
      // Convert all blocks to layout nodes
      const allNodes: LayoutNode[] = Object.values(blocks).map((block) => {
        const category = BLOCK_CATEGORIES[block.type] || 'processing'
        const isContainer = block.type === 'loop' || block.type === 'parallel'

        // Determine dimensions
        let dimensions = BLOCK_DIMENSIONS.default
        if (isContainer) {
          dimensions = BLOCK_DIMENSIONS.container
        } else if (block.isWide) {
          dimensions = BLOCK_DIMENSIONS.wide
        }

        // Use actual height if available
        if (block.height && block.height > 0) {
          dimensions = { ...dimensions, height: block.height }
        }

        return {
          id: block.id,
          type: block.type,
          name: block.name || `${block.type} Block`,
          width: dimensions.width,
          height: dimensions.height,
          position: block.position,
          category,
          isContainer,
          parentId: block.data?.parentId || block.parentId,
          horizontalHandles: block.horizontalHandles ?? true,
          isWide: block.isWide ?? false,
        }
      })

      // Convert edges to layout format
      const layoutEdges: LayoutEdge[] = edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: edge.type,
      }))

      // For the main graph, only include top-level nodes
      const topLevelNodes = allNodes.filter((node) => !node.parentId)
      const topLevelEdges = layoutEdges.filter((edge) => {
        const sourceIsTopLevel = topLevelNodes.some((n) => n.id === edge.source)
        const targetIsTopLevel = topLevelNodes.some((n) => n.id === edge.target)
        return sourceIsTopLevel && targetIsTopLevel
      })

      logger.info('Converted workflow to graph with nested support', {
        totalNodes: allNodes.length,
        topLevelNodes: topLevelNodes.length,
        edges: layoutEdges.length,
        topLevelEdges: topLevelEdges.length,
        categories: this.countByCategory(topLevelNodes),
      })

      return {
        nodes: topLevelNodes,
        edges: topLevelEdges,
      }
    } catch (error) {
      logger.error('Failed to convert workflow to graph', {
        error: error instanceof Error ? error.message : 'Unknown error',
        blockCount: Object.keys(blocks).length,
        edgeCount: edges.length,
      })
      throw error
    }
  }

  /**
   * Convert layout result back to workflow store format with nested block support
   */
  convertResultToWorkflow(
    result: LayoutResult,
    originalBlocks: Record<string, any>,
    allBlocks: Record<string, any>,
    allEdges: any[]
  ): Record<string, any> {
    const updatedBlocks = { ...originalBlocks }

    // Apply top-level layout results
    result.nodes.forEach(({ id, position }) => {
      if (updatedBlocks[id]) {
        updatedBlocks[id] = {
          ...updatedBlocks[id],
          position: {
            x: Math.round(position.x),
            y: Math.round(position.y),
          },
        }
      }
    })

    // Handle nested blocks inside containers
    const containerBlocks = result.nodes.filter(
      (node) =>
        updatedBlocks[node.id]?.type === 'loop' || updatedBlocks[node.id]?.type === 'parallel'
    )

    containerBlocks.forEach((containerNode) => {
      const containerId = containerNode.id

      // Get child blocks for this container
      const childBlocks = Object.fromEntries(
        Object.entries(allBlocks).filter(
          ([_, block]) => block.data?.parentId === containerId || block.parentId === containerId
        )
      )

      if (Object.keys(childBlocks).length === 0) return

      // Get edges between child blocks
      const childEdges = allEdges.filter(
        (edge) => childBlocks[edge.source] && childBlocks[edge.target]
      )

      // Layout child blocks with container-specific options
      const childGraph = this.createChildGraph(childBlocks, childEdges)

      if (childGraph.nodes.length > 0) {
        try {
          const childLayoutOptions: LayoutOptions = {
            strategy: 'smart',
            direction: 'auto',
            spacing: {
              horizontal: 300,
              vertical: 150,
              layer: 400,
            },
            alignment: 'center',
            padding: {
              x: 50,
              y: 80,
            },
          }

          const childResult = this.calculateChildLayout(childGraph, childLayoutOptions)

          // Apply child positions relative to container
          childResult.nodes.forEach(({ id, position }) => {
            if (updatedBlocks[id]) {
              updatedBlocks[id] = {
                ...updatedBlocks[id],
                position: {
                  x: Math.round(position.x),
                  y: Math.round(position.y),
                },
              }
            }
          })

          // Update container dimensions to fit children
          const containerDimensions = this.calculateContainerDimensions(
            childResult.nodes,
            childBlocks
          )

          if (updatedBlocks[containerId]) {
            updatedBlocks[containerId] = {
              ...updatedBlocks[containerId],
              data: {
                ...updatedBlocks[containerId].data,
                width: containerDimensions.width,
                height: containerDimensions.height,
              },
            }
          }

          logger.info('Laid out child blocks for container', {
            containerId,
            childCount: childResult.nodes.length,
            containerWidth: containerDimensions.width,
            containerHeight: containerDimensions.height,
          })
        } catch (error) {
          logger.warn('Failed to layout child blocks for container', {
            containerId,
            error: error instanceof Error ? error.message : 'Unknown error',
            childCount: Object.keys(childBlocks).length,
          })
        }
      }
    })

    logger.info('Converted layout result to workflow format with nested blocks', {
      updatedNodes: result.nodes.length,
      totalBlocks: Object.keys(updatedBlocks).length,
      containerBlocks: containerBlocks.length,
    })

    return updatedBlocks
  }

  /**
   * Create a graph for child blocks inside a container
   */
  private createChildGraph(childBlocks: Record<string, any>, childEdges: any[]): WorkflowGraph {
    const nodes: LayoutNode[] = Object.values(childBlocks).map((block) => {
      const category = BLOCK_CATEGORIES[block.type] || 'processing'
      const isContainer = block.type === 'loop' || block.type === 'parallel'

      let dimensions = BLOCK_DIMENSIONS.default
      if (isContainer) {
        dimensions = BLOCK_DIMENSIONS.container
      } else if (block.isWide) {
        dimensions = BLOCK_DIMENSIONS.wide
      }

      if (block.height && block.height > 0) {
        dimensions = { ...dimensions, height: block.height }
      }

      return {
        id: block.id,
        type: block.type,
        name: block.name || `${block.type} Block`,
        width: dimensions.width,
        height: dimensions.height,
        position: block.position,
        category,
        isContainer,
        parentId: block.data?.parentId || block.parentId,
        horizontalHandles: block.horizontalHandles ?? true,
        isWide: block.isWide ?? false,
      }
    })

    const edges: LayoutEdge[] = childEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: edge.type,
    }))

    return { nodes, edges }
  }

  /**
   * Calculate layout for child blocks using simplified algorithms
   */
  private calculateChildLayout(childGraph: WorkflowGraph, options: LayoutOptions): LayoutResult {
    // Use hierarchical layout for child blocks as it's simpler and more predictable
    return calculateHierarchicalLayout(childGraph.nodes, childGraph.edges, options)
  }

  /**
   * Calculate optimal container dimensions based on child blocks
   */
  private calculateContainerDimensions(
    childPositions: Array<{ id: string; position: { x: number; y: number } }>,
    childBlocks: Record<string, any>
  ): { width: number; height: number } {
    const minWidth = 500
    const minHeight = 300
    const padding = 100

    if (childPositions.length === 0) {
      return { width: minWidth, height: minHeight }
    }

    let maxX = 0
    let maxY = 0

    childPositions.forEach(({ id, position }) => {
      const block = childBlocks[id]
      if (!block) return

      let blockWidth = BLOCK_DIMENSIONS.default.width
      let blockHeight = BLOCK_DIMENSIONS.default.height

      if (block.isWide) {
        blockWidth = BLOCK_DIMENSIONS.wide.width
      }
      if (block.height && block.height > 0) {
        blockHeight = block.height
      }

      maxX = Math.max(maxX, position.x + blockWidth)
      maxY = Math.max(maxY, position.y + blockHeight)
    })

    return {
      width: Math.max(minWidth, maxX + padding),
      height: Math.max(minHeight, maxY + padding),
    }
  }

  /**
   * Get default layout options optimized for different scenarios
   */
  getDefaultOptions(scenario: 'simple' | 'complex' | 'presentation' = 'simple'): LayoutOptions {
    const baseOptions: LayoutOptions = {
      strategy: 'smart',
      direction: 'auto',
      spacing: {
        horizontal: 400,
        vertical: 200,
        layer: 600,
      },
      alignment: 'center',
      padding: {
        x: 200,
        y: 200,
      },
    }

    switch (scenario) {
      case 'simple':
        return {
          ...baseOptions,
          spacing: {
            horizontal: 350,
            vertical: 150,
            layer: 500,
          },
        }
      case 'complex':
        return {
          ...baseOptions,
          spacing: {
            horizontal: 450,
            vertical: 250,
            layer: 700,
          },
          padding: {
            x: 300,
            y: 300,
          },
        }
      case 'presentation':
        return {
          ...baseOptions,
          spacing: {
            horizontal: 500,
            vertical: 300,
            layer: 800,
          },
          padding: {
            x: 400,
            y: 400,
          },
          alignment: 'center',
        }
      default:
        return baseOptions
    }
  }

  private validateWorkflowGraph(graph: WorkflowGraph): void {
    if (!graph.nodes || graph.nodes.length === 0) {
      throw new Error('Workflow graph must contain at least one node')
    }

    if (!graph.edges) {
      throw new Error('Workflow graph must have edges array (can be empty)')
    }

    // Validate node structure
    graph.nodes.forEach((node, index) => {
      if (!node.id) {
        throw new Error(`Node at index ${index} is missing id`)
      }
      if (!node.type) {
        throw new Error(`Node ${node.id} is missing type`)
      }
      if (typeof node.width !== 'number' || node.width <= 0) {
        throw new Error(`Node ${node.id} has invalid width`)
      }
      if (typeof node.height !== 'number' || node.height <= 0) {
        throw new Error(`Node ${node.id} has invalid height`)
      }
    })

    // Validate edge structure
    graph.edges.forEach((edge, index) => {
      if (!edge.id) {
        throw new Error(`Edge at index ${index} is missing id`)
      }
      if (!edge.source) {
        throw new Error(`Edge ${edge.id} is missing source`)
      }
      if (!edge.target) {
        throw new Error(`Edge ${edge.id} is missing target`)
      }

      // Check if source and target nodes exist
      const sourceExists = graph.nodes.some((n) => n.id === edge.source)
      const targetExists = graph.nodes.some((n) => n.id === edge.target)

      if (!sourceExists) {
        throw new Error(`Edge ${edge.id} references non-existent source node: ${edge.source}`)
      }
      if (!targetExists) {
        throw new Error(`Edge ${edge.id} references non-existent target node: ${edge.target}`)
      }
    })
  }

  private countByCategory(nodes: LayoutNode[]): Record<string, number> {
    const counts: Record<string, number> = {}
    nodes.forEach((node) => {
      counts[node.category] = (counts[node.category] || 0) + 1
    })
    return counts
  }
}

// Export singleton instance
export const autoLayoutService = AutoLayoutService.getInstance()

// Export utility functions
export function createWorkflowGraph(blocks: Record<string, any>, edges: any[]): WorkflowGraph {
  return autoLayoutService.convertWorkflowToGraph(blocks, edges)
}

export function applyLayoutToWorkflow(
  result: LayoutResult,
  originalBlocks: Record<string, any>,
  allBlocks: Record<string, any>,
  allEdges: any[]
): Record<string, any> {
  return autoLayoutService.convertResultToWorkflow(result, originalBlocks, allBlocks, allEdges)
}

export async function autoLayoutWorkflow(
  blocks: Record<string, any>,
  edges: any[],
  options: Partial<LayoutOptions> = {}
): Promise<Record<string, any>> {
  const graph = createWorkflowGraph(blocks, edges)
  const result = await autoLayoutService.calculateLayout(graph, options)
  return applyLayoutToWorkflow(result, blocks, blocks, edges)
}
