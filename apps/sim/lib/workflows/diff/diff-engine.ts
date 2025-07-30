import { createLogger } from '@/lib/logs/console-logger'
import { yamlService } from '@/lib/yaml-service-client'
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
      logger.info('WorkflowDiffEngine.createDiffFromYaml called with:', {
        yamlContentLength: yamlContent.length,
        diffAnalysis: diffAnalysis,
        diffAnalysisType: typeof diffAnalysis,
        diffAnalysisUndefined: diffAnalysis === undefined,
        diffAnalysisNull: diffAnalysis === null
      })

      // Get current workflow state for comparison
      const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
      const currentWorkflowState = useWorkflowStore.getState().getWorkflowState()
      
      logger.info('WorkflowDiffEngine current workflow state:', {
        blockCount: Object.keys(currentWorkflowState.blocks || {}).length,
        edgeCount: currentWorkflowState.edges?.length || 0,
        hasLoops: Object.keys(currentWorkflowState.loops || {}).length > 0,
        hasParallels: Object.keys(currentWorkflowState.parallels || {}).length > 0
      })

      // Call the sim agent service to create the diff
      const response = await yamlService.createDiff(yamlContent, diffAnalysis, {
        applyAutoLayout: true,
        currentWorkflowState: currentWorkflowState,
        layoutOptions: {
          strategy: 'smart',
          direction: 'auto',
          spacing: {
            horizontal: 500,
            vertical: 400,
            layer: 700
          },
          alignment: 'center',
          padding: {
            x: 250,
            y: 250
          }
        }
      })
      
      logger.info('WorkflowDiffEngine.createDiffFromYaml response:', {
        success: response.success,
        hasDiff: !!response.diff,
        errors: response.errors,
        hasDiffAnalysis: !!response.diff?.diffAnalysis
      })

      if (!response.success || !response.diff) {
        return {
          success: false,
          errors: response.errors,
        }
      }

      // Log diff analysis details
      if (response.diff.diffAnalysis) {
        logger.info('WorkflowDiffEngine diff analysis:', {
          new_blocks: response.diff.diffAnalysis.new_blocks,
          edited_blocks: response.diff.diffAnalysis.edited_blocks,
          deleted_blocks: response.diff.diffAnalysis.deleted_blocks,
          field_diffs: response.diff.diffAnalysis.field_diffs ? Object.keys(response.diff.diffAnalysis.field_diffs) : [],
          edge_diff: response.diff.diffAnalysis.edge_diff ? {
            new_edges_count: response.diff.diffAnalysis.edge_diff.new_edges.length,
            deleted_edges_count: response.diff.diffAnalysis.edge_diff.deleted_edges.length,
            unchanged_edges_count: response.diff.diffAnalysis.edge_diff.unchanged_edges.length
          } : null
        })
      } else {
        logger.warn('WorkflowDiffEngine: No diff analysis in response!')
      }

      // Store the current diff
      this.currentDiff = response.diff

      logger.info('Diff created successfully', {
        blocksCount: Object.keys(response.diff.proposedState.blocks).length,
        edgesCount: response.diff.proposedState.edges.length,
        hasDiffAnalysis: !!response.diff.diffAnalysis
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
   * Merge new YAML content into existing diff
   * Used for cumulative updates within the same message
   */
  async mergeDiffFromYaml(yamlContent: string, diffAnalysis?: DiffAnalysis): Promise<DiffResult> {
    try {
      logger.info('Merging diff from YAML content')

      // If no existing diff, create a new one
      if (!this.currentDiff) {
        logger.info('No existing diff, creating new diff')
        return this.createDiffFromYaml(yamlContent, diffAnalysis)
      }

      // Call the sim agent service to merge the diff
      const response = await yamlService.mergeDiff(
        this.currentDiff,
        yamlContent,
        diffAnalysis,
        {
          applyAutoLayout: true,
          layoutOptions: {
            strategy: 'smart',
            direction: 'auto',
            spacing: {
              horizontal: 500,
              vertical: 400,
              layer: 700
            },
            alignment: 'center',
            padding: {
              x: 250,
              y: 250
            }
          }
        }
      )

      if (!response.success || !response.diff) {
        return {
          success: false,
          errors: response.errors,
        }
      }

      // Update the current diff
      this.currentDiff = response.diff

      logger.info('Diff merged successfully', {
        totalBlocksCount: Object.keys(response.diff.proposedState.blocks).length,
        totalEdgesCount: response.diff.proposedState.edges.length,
      })

      return {
        success: true,
        diff: this.currentDiff,
      }
    } catch (error) {
      logger.error('Failed to merge diff:', error)
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Failed to merge diff'],
      }
    }
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

    try {
      // Clean up the proposed state by removing diff markers
      const cleanState = this.cleanDiffMarkers(this.currentDiff.proposedState)

      logger.info('Diff accepted', {
        blocksCount: Object.keys(cleanState.blocks).length,
        edgesCount: cleanState.edges.length,
        loopsCount: Object.keys(cleanState.loops).length,
        parallelsCount: Object.keys(cleanState.parallels).length,
      })

      this.clearDiff()
      return cleanState
    } catch (error) {
      logger.error('Failed to accept diff:', error)
      return null
    }
  }

  /**
   * Clean diff markers from a workflow state
   */
  private cleanDiffMarkers(state: WorkflowState): WorkflowState {
    const cleanBlocks: Record<string, BlockState> = {}
    
    // Remove diff markers from each block
    for (const [blockId, block] of Object.entries(state.blocks)) {
      const cleanBlock = { ...block }
      
      // Remove diff markers using bracket notation to avoid TypeScript errors
      delete (cleanBlock as any)['is_diff']
      delete (cleanBlock as any)['field_diff']
      
      // Ensure outputs is never null/undefined
      if (cleanBlock.outputs === undefined || cleanBlock.outputs === null) {
        cleanBlock.outputs = {}
      }
      
      cleanBlocks[blockId] = cleanBlock
    }

    return {
      blocks: cleanBlocks,
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
    }
  }


}
