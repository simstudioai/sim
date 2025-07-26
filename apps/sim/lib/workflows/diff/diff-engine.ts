import { createLogger } from '@/lib/logs/console-logger'
import { convertYamlToWorkflowState } from '@/lib/workflows/yaml-converter'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDiffEngine')

export interface DiffMetadata {
  source: string
  timestamp: number
}

export interface EdgeDiff {
  new_edges: string[]
  deleted_edges: string[]
  unchanged_edges: string[]
}

export interface DiffAnalysis {
  new_blocks: string[]
  edited_blocks: string[]
  deleted_blocks: string[]
  field_diffs?: Record<string, { changed_fields: string[]; unchanged_fields: string[] }>
  edge_diff?: EdgeDiff
}

export interface WorkflowDiff {
  proposedState: WorkflowState
  diffAnalysis?: DiffAnalysis
  metadata: DiffMetadata
}

export interface DiffResult {
  success: boolean
  diff?: WorkflowDiff
  errors?: string[]
}

/**
 * Clean diff engine that handles workflow diff operations
 * without polluting core workflow stores
 */
export class WorkflowDiffEngine {
  private currentDiff: WorkflowDiff | null = null

  /**
   * Create a diff from YAML content
   */
  async createDiffFromYaml(yamlContent: string, diffAnalysis?: DiffAnalysis): Promise<DiffResult> {
    try {
      logger.info('Creating diff from YAML content')

      // Convert YAML to workflow state with new IDs
      const conversionResult = await convertYamlToWorkflowState(yamlContent, {
        generateNewIds: true,
      })

      if (!conversionResult.success || !conversionResult.workflowState) {
        return {
          success: false,
          errors: conversionResult.errors,
        }
      }

      const proposedState = conversionResult.workflowState

      logger.info('Conversion result:', {
        hasProposedState: !!proposedState,
        blockCount: proposedState ? Object.keys(proposedState.blocks).length : 0,
        edgeCount: proposedState ? proposedState.edges.length : 0,
      })

      // Add diff markers to blocks if analysis is provided
      let mappedDiffAnalysis = diffAnalysis
      if (diffAnalysis) {
        logger.info('Applying diff markers with analysis:', {
          new_blocks: diffAnalysis.new_blocks,
          edited_blocks: diffAnalysis.edited_blocks,
          deleted_blocks: diffAnalysis.deleted_blocks,
          edge_diff: diffAnalysis.edge_diff,
        })
        this.applyDiffMarkers(proposedState, diffAnalysis, conversionResult.idMapping!)
        // Create a mapped version of the diff analysis with new IDs
        mappedDiffAnalysis = this.createMappedDiffAnalysis(
          diffAnalysis,
          conversionResult.idMapping!
        )
      } else {
        logger.info('No diff analysis provided, skipping diff markers')
      }

      // Debug: Log blocks with parent relationships
      const blocksWithParents = Object.values(proposedState.blocks).filter(
        (block: any) => block.parentNode
      )
      logger.info(`Found ${blocksWithParents.length} blocks with parent relationships`)
      blocksWithParents.forEach((block: any) => {
        logger.info(`Block ${block.id} has parentNode: ${block.parentNode}`)
      })

      // Debug: Log loop and parallel blocks
      const containerBlocks = Object.values(proposedState.blocks).filter(
        (block) => block.type === 'loop' || block.type === 'parallel'
      )
      logger.info(
        `Found ${containerBlocks.length} container blocks (loops/parallels):`,
        containerBlocks.map((b) => ({ id: b.id, type: b.type, name: b.name }))
      )

      // Ensure all blocks have their id property set
      Object.entries(proposedState.blocks).forEach(([blockId, block]) => {
        if (!block.id) {
          logger.warn(`Block ${blockId} missing id property, setting it now`)
          block.id = blockId
        }
      })

      // Debug: Check what Object.values returns
      const blockValues = Object.values(proposedState.blocks)
      logger.info('Object.values(blocks) returns:', {
        count: blockValues.length,
        blocks: blockValues.map((block, index) => ({
          index,
          hasId: !!block.id,
          id: block.id,
          type: block.type,
        })),
      })

      // Apply auto layout using the service directly
      const { autoLayoutWorkflow } = await import('@/lib/autolayout/service')

      try {
        logger.info('Applying auto layout to diff workflow', {
          blockCount: Object.keys(proposedState.blocks).length,
          edgeCount: proposedState.edges.length,
          blocks: Object.keys(proposedState.blocks),
        })

        const layoutedBlocks = await autoLayoutWorkflow(
          proposedState.blocks,
          proposedState.edges,
          {} // Default options
        )

        if (layoutedBlocks) {
          // Apply the layouted blocks
          proposedState.blocks = layoutedBlocks

          // Ensure all blocks still have their id property after layout
          Object.entries(proposedState.blocks).forEach(([blockId, block]) => {
            if (!block.id) {
              logger.warn(`Block ${blockId} lost its id property after layout, restoring it`)
              block.id = blockId
            }
          })

          // Re-apply diff markers after layout
          if (mappedDiffAnalysis) {
            Object.entries(proposedState.blocks).forEach(([blockId, block]) => {
              if (mappedDiffAnalysis.new_blocks.includes(blockId)) {
                ;(block as any).is_diff = 'new'
              } else if (mappedDiffAnalysis.edited_blocks.includes(blockId)) {
                ;(block as any).is_diff = 'edited'

                // Re-apply field-level diff information if available
                if (mappedDiffAnalysis.field_diffs?.[blockId]) {
                  ;(block as any).field_diff = mappedDiffAnalysis.field_diffs[blockId]
                }
              } else {
                ;(block as any).is_diff = 'unchanged'
              }
            })
          }

          logger.info('Auto layout applied successfully')
        } else {
          logger.warn('Auto layout returned no blocks')
        }
      } catch (error) {
        logger.error('Auto layout failed:', error)
        logger.info('Continuing without auto-layout')
      }

      // Create the diff object
      this.currentDiff = {
        proposedState,
        diffAnalysis: mappedDiffAnalysis,
        metadata: {
          source: 'copilot',
          timestamp: Date.now(),
        },
      }

      logger.info('Diff created successfully', {
        blocksCount: Object.keys(proposedState.blocks).length,
        edgesCount: proposedState.edges.length,
      })

      return {
        success: true,
        diff: this.currentDiff,
      }
    } catch (error) {
      logger.error('Failed to create diff:', error)
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Failed to create diff'],
      }
    }
  }

  /**
   * Create a mapped version of diff analysis with new IDs
   */
  private createMappedDiffAnalysis(
    analysis: DiffAnalysis,
    idMapping: Map<string, string>
  ): DiffAnalysis {
    const mapped: DiffAnalysis = {
      new_blocks: analysis.new_blocks.map((oldId) => idMapping.get(oldId) || oldId),
      edited_blocks: analysis.edited_blocks.map((oldId) => idMapping.get(oldId) || oldId),
      deleted_blocks: analysis.deleted_blocks, // Deleted blocks won't have new IDs
    }

    // Map field diffs with new IDs
    if (analysis.field_diffs) {
      mapped.field_diffs = {}
      Object.entries(analysis.field_diffs).forEach(([oldId, fieldDiff]) => {
        const newId = idMapping.get(oldId) || oldId
        mapped.field_diffs![newId] = fieldDiff
      })
    }

    // Edge identifiers use block names (not IDs), so they don't need mapping
    // They should remain as-is since block names are stable between workflows
    if (analysis.edge_diff) {
      mapped.edge_diff = {
        new_edges: analysis.edge_diff.new_edges, // Keep original - uses block names
        deleted_edges: analysis.edge_diff.deleted_edges, // Keep original - uses block names
        unchanged_edges: analysis.edge_diff.unchanged_edges, // Keep original - uses block names
      }
    }

    return mapped
  }

  /**
   * Adjust child block positions to be relative to their parent containers
   */
  private adjustChildBlockPositions(blocks: Record<string, BlockState>): void {
    // Group blocks by their parent
    const blocksByParent = new Map<string, BlockState[]>()

    Object.values(blocks).forEach((block) => {
      const parentId = block.data?.parentId || (block as any).parentNode
      if (parentId && blocks[parentId]) {
        if (!blocksByParent.has(parentId)) {
          blocksByParent.set(parentId, [])
        }
        blocksByParent.get(parentId)!.push(block)
      }
    })

    // Adjust positions for each parent's children
    blocksByParent.forEach((childBlocks, parentId) => {
      const parentBlock = blocks[parentId]
      if (!parentBlock) return

      // Get parent position
      const parentPos = parentBlock.position

      logger.info(`Adjusting ${childBlocks.length} child blocks for parent ${parentId}`)

      // Track bounds for container sizing
      let maxX = 0
      let maxY = 0

      // Make child positions relative to parent
      childBlocks.forEach((childBlock) => {
        const currentPos = childBlock.position

        // Check if position is already relative (within reasonable bounds of parent container)
        const isAlreadyRelative = Math.abs(currentPos.x) < 800 && Math.abs(currentPos.y) < 600

        if (!isAlreadyRelative) {
          // Position seems absolute, convert to relative
          const relativePos = {
            x: currentPos.x - parentPos.x,
            y: currentPos.y - parentPos.y,
          }

          childBlock.position = relativePos
          logger.info(
            `Adjusted child block ${childBlock.id} position from absolute`,
            currentPos,
            'to relative',
            relativePos
          )
        } else {
          logger.info(`Child block ${childBlock.id} position already relative:`, currentPos)
        }

        // Track max bounds for container sizing
        const blockWidth = childBlock.isWide ? 450 : 350
        const blockHeight = Math.max(childBlock.height || 100, 100)
        maxX = Math.max(maxX, childBlock.position.x + blockWidth)
        maxY = Math.max(maxY, childBlock.position.y + blockHeight)
      })

      // Update container dimensions to fit all children
      if (parentBlock.type === 'loop' || parentBlock.type === 'parallel') {
        const padding = 150 // Extra padding for container
        const minWidth = 500
        const minHeight = 300

        parentBlock.data = {
          ...parentBlock.data,
          width: Math.max(minWidth, maxX + padding),
          height: Math.max(minHeight, maxY + padding),
        }

        logger.info(`Updated container ${parentId} dimensions:`, {
          width: parentBlock.data.width,
          height: parentBlock.data.height,
        })
      }
    })
  }

  /**
   * Apply diff markers to blocks based on analysis
   */
  private applyDiffMarkers(
    state: WorkflowState,
    analysis: DiffAnalysis,
    idMapping: Map<string, string>
  ): void {
    console.log('[DiffEngine] Applying diff markers:', {
      newBlocks: analysis.new_blocks,
      editedBlocks: analysis.edited_blocks,
      deletedBlocks: analysis.deleted_blocks,
      totalBlocks: Object.keys(state.blocks).length,
      timestamp: Date.now(),
    })

    // Create reverse mapping from new IDs to original IDs
    const reverseMapping = new Map<string, string>()
    idMapping.forEach((newId, originalId) => {
      reverseMapping.set(newId, originalId)
    })

    let markersApplied = 0
    Object.entries(state.blocks).forEach(([blockId, block]) => {
      // Find original ID to check diff analysis
      const originalId = reverseMapping.get(blockId)

      if (originalId) {
        if (analysis.new_blocks.includes(originalId)) {
          ;(block as any).is_diff = 'new'
          markersApplied++
          logger.info(`Block ${blockId} (original: ${originalId}) marked as new`)
        } else if (analysis.edited_blocks.includes(originalId)) {
          ;(block as any).is_diff = 'edited'
          markersApplied++

          // Add field-level diff information if available
          if (analysis.field_diffs?.[originalId]) {
            ;(block as any).field_diff = analysis.field_diffs[originalId]
            logger.info(
              `Block ${blockId} (original: ${originalId}) marked as edited with field diff:`,
              {
                changed_fields: analysis.field_diffs[originalId].changed_fields,
                unchanged_fields: analysis.field_diffs[originalId].unchanged_fields.length,
              }
            )
          } else {
            logger.info(`Block ${blockId} (original: ${originalId}) marked as edited`)
          }
        } else {
          ;(block as any).is_diff = 'unchanged'
        }
      } else {
        ;(block as any).is_diff = 'unchanged'
        logger.warn(`Block ${blockId} has no original ID mapping`)
      }
    })

    console.log('[DiffEngine] Diff markers applied:', {
      markersApplied,
      totalBlocks: Object.keys(state.blocks).length,
      timestamp: Date.now(),
    })
  }

  /**
   * Get the current diff
   */
  getCurrentDiff(): WorkflowDiff | null {
    return this.currentDiff
  }

  /**
   * Clear the current diff
   */
  clearDiff(): void {
    this.currentDiff = null
    logger.info('Diff cleared')
  }

  /**
   * Check if a diff is active
   */
  hasDiff(): boolean {
    return this.currentDiff !== null
  }

  /**
   * Get the workflow state for display (either diff or provided state)
   */
  getDisplayState(currentState: WorkflowState): WorkflowState {
    if (this.currentDiff) {
      return this.currentDiff.proposedState
    }
    return currentState
  }

  /**
   * Accept the diff and return the clean state
   */
  acceptDiff(): WorkflowState | null {
    if (!this.currentDiff) {
      logger.warn('No diff to accept')
      return null
    }

    const cleanState = { ...this.currentDiff.proposedState }

    // Filter out blocks without type or name and remove diff markers
    const filteredBlocks: Record<string, BlockState> = {}
    Object.entries(cleanState.blocks).forEach(([blockId, block]) => {
      if (block.type && block.name) {
        // Remove diff markers
        ;(block as any).is_diff = undefined
        ;(block as any).field_diff = undefined
        filteredBlocks[blockId] = block
      } else {
        logger.info(`Filtering out block ${blockId} - missing type or name`)
      }
    })

    cleanState.blocks = filteredBlocks

    // Filter out edges that connect to removed blocks
    const validBlockIds = new Set(Object.keys(filteredBlocks))
    cleanState.edges = cleanState.edges.filter(
      (edge) => validBlockIds.has(edge.source) && validBlockIds.has(edge.target)
    )

    logger.info('Diff accepted', {
      blocksCount: Object.keys(cleanState.blocks).length,
      edgesCount: cleanState.edges.length,
    })

    this.clearDiff()
    return cleanState
  }

  /**
   * Analyze differences between two workflow states
   */
  static async analyzeDiff(
    originalYaml: string,
    proposedYaml: string
  ): Promise<DiffAnalysis | null> {
    try {
      const response = await fetch('/api/workflows/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_yaml: originalYaml,
          agent_yaml: proposedYaml,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          return result.data
        }
      }
    } catch (error) {
      logger.error('Failed to analyze diff:', error)
    }

    return null
  }
}
