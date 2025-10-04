import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { mergeSubblockState } from '@/stores/workflows/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import type { BlockWithDiff } from './types'

const logger = createLogger('WorkflowDiffEngine')

type ParentIdentifier = string | null

function getParentId(block?: BlockState): ParentIdentifier {
  return block?.data?.parentId ?? null
}

function buildEdgeKey(edge: Edge): string {
  const sourceHandle = edge.sourceHandle ?? ''
  const targetHandle = edge.targetHandle ?? ''
  const edgeType = edge.type ?? ''
  return `${edge.source}|${sourceHandle}->${edge.target}|${targetHandle}|${edgeType}`
}

function groupBlocksByParent(blocks: Record<string, BlockState>): {
  root: string[]
  children: Map<string, string[]>
} {
  const root: string[] = []
  const children = new Map<string, string[]>()

  for (const [id, block] of Object.entries(blocks)) {
    const parentId = getParentId(block)

    if (!parentId) {
      root.push(id)
      continue
    }

    if (!children.has(parentId)) {
      children.set(parentId, [])
    }

    children.get(parentId)!.push(id)
  }

  return { root, children }
}

function buildAdjacency(edges: Edge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set())
    }
    adjacency.get(edge.source)!.add(edge.target)
  }

  return adjacency
}

function expandImpactedBlocks(
  seeds: Set<string>,
  proposedBlocks: Record<string, BlockState>,
  adjacency: Map<string, Set<string>>
): Set<string> {
  const impacted = new Set<string>()

  // Only expand to direct downstream neighbors (targets of impacted blocks)
  // This ensures we make space for new/moved blocks without relocating unaffected ones
  for (const seed of seeds) {
    if (!proposedBlocks[seed]) continue
    impacted.add(seed)

    const seedBlock = proposedBlocks[seed]
    const seedParent = getParentId(seedBlock)
    const neighbors = adjacency.get(seed)

    if (neighbors) {
      for (const next of neighbors) {
        const nextBlock = proposedBlocks[next]
        if (!nextBlock) continue
        // Only expand within same parent
        if (getParentId(nextBlock) !== seedParent) continue
        impacted.add(next)
      }
    }
  }

  return impacted
}

function computeStructuralLayoutImpact(params: {
  baselineBlocks: Record<string, BlockState>
  baselineEdges: Edge[]
  proposedBlocks: Record<string, BlockState>
  proposedEdges: Edge[]
}): {
  impactedBlockIds: Set<string>
  parentsToRelayout: Set<ParentIdentifier>
} {
  const { baselineBlocks, baselineEdges, proposedBlocks, proposedEdges } = params
  const impactedBlocks = new Set<string>()
  const parentsToRelayout = new Set<ParentIdentifier>()

  const baselineIds = new Set(Object.keys(baselineBlocks))
  const proposedIds = new Set(Object.keys(proposedBlocks))

  for (const id of proposedIds) {
    if (!baselineIds.has(id)) {
      impactedBlocks.add(id)
      parentsToRelayout.add(getParentId(proposedBlocks[id]))
    }
  }

  for (const id of baselineIds) {
    if (!proposedIds.has(id)) {
      parentsToRelayout.add(getParentId(baselineBlocks[id]))
    }
  }

  for (const id of proposedIds) {
    if (!baselineIds.has(id)) {
      continue
    }

    const baselineBlock = baselineBlocks[id]
    const proposedBlock = proposedBlocks[id]

    const baselineParent = getParentId(baselineBlock)
    const proposedParent = getParentId(proposedBlock)

    if (baselineParent !== proposedParent) {
      impactedBlocks.add(id)
      parentsToRelayout.add(baselineParent)
      parentsToRelayout.add(proposedParent)
    }
  }

  const baselineEdgeMap = new Map<string, Edge>()
  for (const edge of baselineEdges) {
    baselineEdgeMap.set(buildEdgeKey(edge), edge)
  }

  const proposedEdgeMap = new Map<string, Edge>()
  for (const edge of proposedEdges) {
    proposedEdgeMap.set(buildEdgeKey(edge), edge)
  }

  for (const [key, edge] of proposedEdgeMap) {
    if (baselineEdgeMap.has(key)) {
      continue
    }

    if (proposedBlocks[edge.source]) {
      impactedBlocks.add(edge.source)
    }
    if (proposedBlocks[edge.target]) {
      impactedBlocks.add(edge.target)
    }
  }

  for (const [key, edge] of baselineEdgeMap) {
    if (proposedEdgeMap.has(key)) {
      continue
    }

    if (proposedBlocks[edge.source]) {
      impactedBlocks.add(edge.source)
    }
    if (proposedBlocks[edge.target]) {
      impactedBlocks.add(edge.target)
    }

    parentsToRelayout.add(getParentId(baselineBlocks[edge.source]))
    parentsToRelayout.add(getParentId(baselineBlocks[edge.target]))
  }

  const adjacency = buildAdjacency(proposedEdges)

  const seedBlocks = new Set<string>()
  for (const id of impactedBlocks) {
    if (proposedBlocks[id]) {
      seedBlocks.add(id)
    }
  }

  const expandedImpacts = expandImpactedBlocks(seedBlocks, proposedBlocks, adjacency)

  // Add parent containers to impacted set so their updated dimensions get transferred
  const parentsWithImpactedChildren = new Set<string>()
  for (const blockId of expandedImpacts) {
    const block = proposedBlocks[blockId]
    if (!block) continue
    const parentId = getParentId(block)
    if (parentId && proposedBlocks[parentId]) {
      parentsWithImpactedChildren.add(parentId)
    }
  }

  for (const parentId of parentsWithImpactedChildren) {
    expandedImpacts.add(parentId)
  }

  return {
    impactedBlockIds: expandedImpacts,
    parentsToRelayout,
  }
}

// Helper function to check if a block has changed
function hasBlockChanged(currentBlock: BlockState, proposedBlock: BlockState): boolean {
  // Compare key fields that indicate a change
  if (currentBlock.type !== proposedBlock.type) return true
  if (currentBlock.name !== proposedBlock.name) return true
  if (currentBlock.enabled !== proposedBlock.enabled) return true
  if (currentBlock.triggerMode !== proposedBlock.triggerMode) return true

  // Compare subBlocks
  const currentSubKeys = Object.keys(currentBlock.subBlocks || {})
  const proposedSubKeys = Object.keys(proposedBlock.subBlocks || {})

  if (currentSubKeys.length !== proposedSubKeys.length) return true

  for (const key of currentSubKeys) {
    if (!proposedSubKeys.includes(key)) return true
    const currentSub = currentBlock.subBlocks[key]
    const proposedSub = proposedBlock.subBlocks?.[key]
    if (!proposedSub) return true
    if (JSON.stringify(currentSub.value) !== JSON.stringify(proposedSub.value)) return true
  }

  return false
}

// Helper function to compute field differences between blocks
function computeFieldDiff(
  currentBlock: BlockState,
  proposedBlock: BlockState
): {
  changedFields: string[]
  unchangedFields: string[]
} {
  const changedFields: string[] = []
  const unchangedFields: string[] = []

  // Check basic fields
  const fieldsToCheck = ['type', 'name', 'enabled', 'triggerMode', 'horizontalHandles', 'isWide']
  for (const field of fieldsToCheck) {
    const currentValue = (currentBlock as any)[field]
    const proposedValue = (proposedBlock as any)[field]
    if (JSON.stringify(currentValue) !== JSON.stringify(proposedValue)) {
      changedFields.push(field)
    } else if (currentValue !== undefined) {
      unchangedFields.push(field)
    }
  }

  // Check subBlocks - use just the key name for UI compatibility
  const currentSubKeys = Object.keys(currentBlock.subBlocks || {})
  const proposedSubKeys = Object.keys(proposedBlock.subBlocks || {})
  const allSubKeys = new Set([...currentSubKeys, ...proposedSubKeys])

  for (const key of allSubKeys) {
    const currentSub = currentBlock.subBlocks?.[key]
    const proposedSub = proposedBlock.subBlocks?.[key]

    if (!currentSub && proposedSub) {
      // New subblock
      changedFields.push(key)
    } else if (currentSub && !proposedSub) {
      // Deleted subblock
      changedFields.push(key)
    } else if (currentSub && proposedSub) {
      // Check if value changed
      if (JSON.stringify(currentSub.value) !== JSON.stringify(proposedSub.value)) {
        changedFields.push(key)
      } else {
        unchangedFields.push(key)
      }
    }
  }

  return { changedFields, unchangedFields }
}

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
  private currentDiff: WorkflowDiff | undefined = undefined

  /**
   * Create a diff from workflow state
   */
  async createDiff(jsonContent: string, diffAnalysis?: DiffAnalysis): Promise<DiffResult> {
    try {
      logger.info('WorkflowDiffEngine.createDiff called with:', {
        jsonContentLength: jsonContent.length,
        diffAnalysis: diffAnalysis,
        diffAnalysisType: typeof diffAnalysis,
        diffAnalysisUndefined: diffAnalysis === undefined,
        diffAnalysisNull: diffAnalysis === null,
      })

      // Get current workflow state for comparison
      const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
      const currentWorkflowState = useWorkflowStore.getState().getWorkflowState()

      logger.info('WorkflowDiffEngine current workflow state:', {
        blockCount: Object.keys(currentWorkflowState.blocks || {}).length,
        edgeCount: currentWorkflowState.edges?.length || 0,
        hasLoops: Object.keys(currentWorkflowState.loops || {}).length > 0,
        hasParallels: Object.keys(currentWorkflowState.parallels || {}).length > 0,
      })

      // Merge subblock values from subblock store to ensure manual edits are included in baseline
      let mergedBaseline: WorkflowState = currentWorkflowState
      try {
        mergedBaseline = {
          ...currentWorkflowState,
          blocks: mergeSubblockState(currentWorkflowState.blocks),
        }
        logger.info('Merged subblock values into baseline for diff creation', {
          blockCount: Object.keys(mergedBaseline.blocks || {}).length,
        })
      } catch (mergeError) {
        logger.warn('Failed to merge subblock values into baseline; proceeding with raw state', {
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        })
      }

      // Call the API route to create the diff
      const body: any = {
        jsonContent,
        currentWorkflowState: mergedBaseline,
      }

      if (diffAnalysis !== undefined && diffAnalysis !== null) {
        body.diffAnalysis = diffAnalysis
      }

      body.options = {
        applyAutoLayout: true,
        layoutOptions: {
          strategy: 'smart',
          direction: 'auto',
          spacing: {
            horizontal: 500,
            vertical: 400,
            layer: 700,
          },
          alignment: 'center',
          padding: {
            x: 250,
            y: 250,
          },
        },
      }

      const response = await fetch('/api/yaml/diff/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        logger.error('Failed to create diff:', {
          status: response.status,
          error: errorData,
        })
        return {
          success: false,
          errors: [errorData?.error || `Failed to create diff: ${response.statusText}`],
        }
      }

      const result = await response.json()

      logger.info('WorkflowDiffEngine.createDiff response:', {
        success: result.success,
        hasDiff: !!result.diff,
        errors: result.errors,
        hasDiffAnalysis: !!result.diff?.diffAnalysis,
      })

      if (!result.success || !result.diff) {
        return {
          success: false,
          errors: result.errors,
        }
      }

      // Log diff analysis details
      if (result.diff.diffAnalysis) {
        logger.info('WorkflowDiffEngine diff analysis:', {
          new_blocks: result.diff.diffAnalysis.new_blocks,
          edited_blocks: result.diff.diffAnalysis.edited_blocks,
          deleted_blocks: result.diff.diffAnalysis.deleted_blocks,
          field_diffs: result.diff.diffAnalysis.field_diffs
            ? Object.keys(result.diff.diffAnalysis.field_diffs)
            : [],
          edge_diff: result.diff.diffAnalysis.edge_diff
            ? {
                new_edges_count: result.diff.diffAnalysis.edge_diff.new_edges.length,
                deleted_edges_count: result.diff.diffAnalysis.edge_diff.deleted_edges.length,
                unchanged_edges_count: result.diff.diffAnalysis.edge_diff.unchanged_edges.length,
              }
            : null,
        })
      } else {
        logger.warn('WorkflowDiffEngine: No diff analysis in response!')
      }

      // Store the current diff
      this.currentDiff = result.diff

      logger.info('Diff created successfully', {
        blocksCount: Object.keys(result.diff.proposedState.blocks).length,
        edgesCount: result.diff.proposedState.edges.length,
        hasDiffAnalysis: !!result.diff.diffAnalysis,
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
   * Create a diff from a WorkflowState object directly (more efficient than YAML)
   * This follows the same logic as sim-agent's YamlDiffCreate handler
   */
  async createDiffFromWorkflowState(
    proposedState: WorkflowState,
    diffAnalysis?: DiffAnalysis
  ): Promise<DiffResult & { diff?: WorkflowDiff }> {
    try {
      logger.info('WorkflowDiffEngine.createDiffFromWorkflowState called with:', {
        blockCount: Object.keys(proposedState.blocks || {}).length,
        edgeCount: proposedState.edges?.length || 0,
        hasDiffAnalysis: !!diffAnalysis,
      })

      // Get baseline for comparison
      // If we already have a diff, use it as baseline (editing on top of diff)
      // Otherwise use the current workflow state
      const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
      const currentWorkflowState = useWorkflowStore.getState().getWorkflowState()

      // Check if we're editing on top of an existing diff
      const baselineForComparison = this.currentDiff?.proposedState || currentWorkflowState
      const isEditingOnTopOfDiff = !!this.currentDiff

      if (isEditingOnTopOfDiff) {
        logger.info('Editing on top of existing diff - using diff as baseline for comparison', {
          diffBlockCount: Object.keys(this.currentDiff!.proposedState.blocks).length,
        })
      }

      // Merge subblock values from subblock store to ensure manual edits are included
      let mergedBaseline: WorkflowState = baselineForComparison

      // Only merge subblock values if we're comparing against original workflow
      // If editing on top of diff, use the diff state as-is
      if (!isEditingOnTopOfDiff) {
        try {
          mergedBaseline = {
            ...baselineForComparison,
            blocks: mergeSubblockState(baselineForComparison.blocks),
          }
          logger.info('Merged subblock values into baseline for diff creation', {
            blockCount: Object.keys(mergedBaseline.blocks || {}).length,
          })
        } catch (mergeError) {
          logger.warn('Failed to merge subblock values into baseline; proceeding with raw state', {
            error: mergeError instanceof Error ? mergeError.message : String(mergeError),
          })
        }
      } else {
        logger.info(
          'Using diff state as baseline without merging subblocks (editing on top of diff)'
        )
      }

      // Build a map of existing blocks by type:name for matching
      const existingBlockMap: Record<string, { id: string; block: BlockState }> = {}
      for (const [id, block] of Object.entries(mergedBaseline.blocks)) {
        const key = `${block.type}:${block.name}`
        existingBlockMap[key] = { id, block }
      }

      // Create ID mapping - preserve existing IDs where blocks match by type:name
      const idMap: Record<string, string> = {}
      const finalBlocks: Record<string, BlockState & BlockWithDiff> = {}

      // First pass: build ID mappings
      for (const [proposedId, proposedBlock] of Object.entries(proposedState.blocks)) {
        const key = `${proposedBlock.type}:${proposedBlock.name}`

        // Check if this block exists in current state by type:name
        if (existingBlockMap[key]) {
          // Preserve existing ID
          idMap[proposedId] = existingBlockMap[key].id
        } else {
          // Generate new ID for truly new blocks
          const newId = uuidv4()
          idMap[proposedId] = newId
        }
      }

      // Second pass: build final blocks with mapped IDs
      for (const [proposedId, proposedBlock] of Object.entries(proposedState.blocks)) {
        const finalId = idMap[proposedId]
        const key = `${proposedBlock.type}:${proposedBlock.name}`
        const existingBlock = existingBlockMap[key]?.block

        // Merge with existing block if found, otherwise use proposed
        const finalBlock: BlockState & BlockWithDiff = existingBlock
          ? {
              ...existingBlock,
              ...proposedBlock,
              id: finalId,
              // Preserve position from proposed or fallback to existing
              position: proposedBlock.position || existingBlock.position,
            }
          : {
              ...proposedBlock,
              id: finalId,
            }

        // Update parentId in data if it exists and has been remapped
        if (finalBlock.data?.parentId && idMap[finalBlock.data.parentId]) {
          finalBlock.data = {
            ...finalBlock.data,
            parentId: idMap[finalBlock.data.parentId],
          }
        }

        finalBlocks[finalId] = finalBlock
      }

      // Map edges with new IDs and standardized handles
      const edgeMap = new Map<string, Edge>()

      proposedState.edges.forEach((edge) => {
        const source = idMap[edge.source] || edge.source
        const target = idMap[edge.target] || edge.target
        const sourceHandle = edge.sourceHandle || 'source'
        const targetHandle = edge.targetHandle || 'target'

        // Create a unique key for deduplication
        const edgeKey = `${source}-${sourceHandle}-${target}-${targetHandle}`

        // Only add if we haven't seen this edge combination before
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            ...edge,
            id: uuidv4(), // Use UUID for unique edge IDs
            source,
            target,
            sourceHandle,
            targetHandle,
            type: edge.type || 'workflowEdge',
          })
        }
      })

      const finalEdges: Edge[] = Array.from(edgeMap.values())

      // Build final proposed state
      const finalProposedState: WorkflowState = {
        blocks: finalBlocks,
        edges: finalEdges,
        loops: proposedState.loops || {},
        parallels: proposedState.parallels || {},
        lastSaved: Date.now(),
      }

      // Ensure loops and parallels are generated
      if (Object.keys(finalProposedState.loops).length === 0) {
        const { generateLoopBlocks } = await import('@/stores/workflows/workflow/utils')
        finalProposedState.loops = generateLoopBlocks(finalProposedState.blocks)
      }
      if (Object.keys(finalProposedState.parallels).length === 0) {
        const { generateParallelBlocks } = await import('@/stores/workflows/workflow/utils')
        finalProposedState.parallels = generateParallelBlocks(finalProposedState.blocks)
      }

      // Transfer block heights from baseline workflow for better measurements in diff view
      // If editing on top of diff, this transfers from the diff (which already has good heights)
      // Otherwise transfers from original workflow
      logger.info('Transferring block heights from baseline workflow', {
        isEditingOnTopOfDiff,
        baselineBlockCount: Object.keys(mergedBaseline.blocks).length,
      })
      try {
        const { transferBlockHeights } = await import('@/lib/workflows/autolayout')
        transferBlockHeights(mergedBaseline.blocks, finalBlocks)
      } catch (error) {
        logger.warn('Failed to transfer block heights', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Apply autolayout to the proposed state
      logger.info('Applying autolayout to proposed workflow state')
      try {
        // Compute diff analysis if not already provided to determine changed blocks
        let tempComputed = diffAnalysis
        if (!tempComputed) {
          const currentIds = new Set(Object.keys(mergedBaseline.blocks))
          const newBlocks: string[] = []
          const editedBlocks: string[] = []

          for (const [id, block] of Object.entries(finalBlocks)) {
            if (!currentIds.has(id)) {
              newBlocks.push(id)
            } else {
              const currentBlock = mergedBaseline.blocks[id]
              if (hasBlockChanged(currentBlock, block)) {
                editedBlocks.push(id)
              }
            }
          }

          tempComputed = { new_blocks: newBlocks, edited_blocks: editedBlocks, deleted_blocks: [] }
        }

        const { impactedBlockIds } = computeStructuralLayoutImpact({
          baselineBlocks: mergedBaseline.blocks,
          baselineEdges: mergedBaseline.edges as Edge[],
          proposedBlocks: finalBlocks,
          proposedEdges: finalEdges,
        })

        const impactedBlockArray = Array.from(impactedBlockIds)
        const totalBlocks = Object.keys(finalBlocks).length
        const unchangedBlocks = totalBlocks - impactedBlockArray.length

        if (impactedBlockArray.length === 0) {
          logger.info('No structural changes detected; skipping autolayout', {
            totalBlocks,
          })
        } else if (unchangedBlocks > 0) {
          // Use targeted layout - preserves positions of unchanged blocks
          logger.info('Using targeted layout for copilot edits (has unchanged blocks)', {
            changedBlocks: impactedBlockArray.length,
            unchangedBlocks: unchangedBlocks,
            totalBlocks: totalBlocks,
            percentChanged: Math.round((impactedBlockArray.length / totalBlocks) * 100),
          })

          const { applyTargetedLayout } = await import('@/lib/workflows/autolayout')

          const layoutedBlocks = applyTargetedLayout(finalBlocks, finalProposedState.edges, {
            changedBlockIds: impactedBlockArray,
            horizontalSpacing: 550,
            verticalSpacing: 200,
          })

          Object.entries(layoutedBlocks).forEach(([id, layoutBlock]) => {
            if (finalBlocks[id]) {
              finalBlocks[id].position = layoutBlock.position

              if (layoutBlock.data) {
                finalBlocks[id].data = {
                  ...finalBlocks[id].data,
                  ...layoutBlock.data,
                }
              }

              if (layoutBlock.layout) {
                finalBlocks[id].layout = {
                  ...finalBlocks[id].layout,
                  ...layoutBlock.layout,
                }
              }

              if (typeof layoutBlock.height === 'number') {
                finalBlocks[id].height = layoutBlock.height
              }

              if (typeof layoutBlock.isWide === 'boolean') {
                finalBlocks[id].isWide = layoutBlock.isWide
              }
            }
          })

          logger.info('Successfully applied targeted layout to proposed state', {
            blocksLayouted: Object.keys(layoutedBlocks).length,
            changedBlocks: impactedBlockArray.length,
          })
        } else {
          // Use full autolayout only when copilot built 100% of the workflow from scratch
          logger.info('Using full autolayout (copilot built 100% of workflow)', {
            totalBlocks: totalBlocks,
            allBlocksAreNew: impactedBlockArray.length === totalBlocks,
          })

          const { applyAutoLayout: applyNativeAutoLayout } = await import(
            '@/lib/workflows/autolayout'
          )

          const autoLayoutOptions = {
            horizontalSpacing: 550,
            verticalSpacing: 200,
            padding: {
              x: 150,
              y: 150,
            },
            alignment: 'center' as const,
          }

          const layoutResult = applyNativeAutoLayout(
            finalBlocks,
            finalProposedState.edges,
            finalProposedState.loops || {},
            finalProposedState.parallels || {},
            autoLayoutOptions
          )

          if (layoutResult.success && layoutResult.blocks) {
            Object.entries(layoutResult.blocks).forEach(([id, layoutBlock]) => {
              if (finalBlocks[id]) {
                finalBlocks[id].position = layoutBlock.position
              }
            })
            logger.info('Successfully applied full autolayout to proposed state', {
              blocksLayouted: Object.keys(layoutResult.blocks).length,
            })
          } else {
            logger.warn('Autolayout failed, using default positions', {
              error: layoutResult.error,
            })
          }
        }
      } catch (layoutError) {
        logger.warn('Error applying autolayout, using default positions', {
          error: layoutError instanceof Error ? layoutError.message : String(layoutError),
        })
      }

      // Compute diff analysis if not provided
      let computed = diffAnalysis
      if (!computed) {
        // Generate diff analysis between current and proposed states
        const currentIds = new Set(Object.keys(mergedBaseline.blocks))
        const proposedIds = new Set(Object.keys(finalBlocks))

        const newBlocks: string[] = []
        const editedBlocks: string[] = []
        const deletedBlocks: string[] = []

        // Find new and edited blocks
        for (const [id, block] of Object.entries(finalBlocks)) {
          if (!currentIds.has(id)) {
            newBlocks.push(id)
          } else {
            // Check if block was edited by comparing key fields
            const currentBlock = mergedBaseline.blocks[id]
            if (hasBlockChanged(currentBlock, block)) {
              editedBlocks.push(id)
            }
          }
        }

        // Find deleted blocks
        for (const id of currentIds) {
          if (!proposedIds.has(id)) {
            deletedBlocks.push(id)
          }
        }

        // Compute field diffs for edited blocks
        const fieldDiffs: Record<string, { changed_fields: string[]; unchanged_fields: string[] }> =
          {}
        for (const id of editedBlocks) {
          const currentBlock = mergedBaseline.blocks[id]
          const proposedBlock = finalBlocks[id]
          const { changedFields, unchangedFields } = computeFieldDiff(currentBlock, proposedBlock)
          if (changedFields.length > 0) {
            fieldDiffs[id] = {
              changed_fields: changedFields,
              unchanged_fields: unchangedFields,
            }
          }
        }

        // Compute edge diffs
        const currentEdgeSet = new Set<string>()
        const proposedEdgeSet = new Set<string>()

        // Create edge identifiers for current state (using sim-agent format)
        mergedBaseline.edges.forEach((edge: any) => {
          const edgeId = `${edge.source}-${edge.sourceHandle || 'source'}-${edge.target}-${edge.targetHandle || 'target'}`
          currentEdgeSet.add(edgeId)
        })

        // Create edge identifiers for proposed state
        finalEdges.forEach((edge) => {
          const edgeId = `${edge.source}-${edge.sourceHandle || 'source'}-${edge.target}-${edge.targetHandle || 'target'}`
          proposedEdgeSet.add(edgeId)
        })

        // Classify edges
        const newEdges: string[] = []
        const deletedEdges: string[] = []
        const unchangedEdges: string[] = []

        // Find new edges (in proposed but not current)
        proposedEdgeSet.forEach((edgeId) => {
          if (!currentEdgeSet.has(edgeId)) {
            newEdges.push(edgeId)
          } else {
            unchangedEdges.push(edgeId)
          }
        })

        // Find deleted edges (in current but not proposed)
        currentEdgeSet.forEach((edgeId) => {
          if (!proposedEdgeSet.has(edgeId)) {
            deletedEdges.push(edgeId)
          }
        })

        computed = {
          new_blocks: newBlocks,
          edited_blocks: editedBlocks,
          deleted_blocks: deletedBlocks,
          field_diffs: Object.keys(fieldDiffs).length > 0 ? fieldDiffs : undefined,
          edge_diff: {
            new_edges: newEdges,
            deleted_edges: deletedEdges,
            unchanged_edges: unchangedEdges,
          },
        }
      }

      // Apply diff markers to blocks
      if (computed) {
        for (const id of computed.new_blocks || []) {
          if (finalBlocks[id]) {
            finalBlocks[id].is_diff = 'new'
          }
        }
        for (const id of computed.edited_blocks || []) {
          if (finalBlocks[id]) {
            finalBlocks[id].is_diff = 'edited'

            // Also mark specific subblocks that changed
            if (computed.field_diffs?.[id]) {
              const fieldDiff = computed.field_diffs[id]
              const block = finalBlocks[id]

              // Apply diff markers to changed subblocks
              for (const changedField of fieldDiff.changed_fields) {
                if (block.subBlocks?.[changedField]) {
                  // Add a diff marker to the subblock itself
                  ;(block.subBlocks[changedField] as any).is_diff = 'changed'
                }
              }
            }
          }
        }
        // Note: We don't remove deleted blocks from finalBlocks, just mark them
      }

      // Store the diff
      this.currentDiff = {
        proposedState: finalProposedState,
        diffAnalysis: computed,
        metadata: {
          source: 'workflow_state',
          timestamp: Date.now(),
        },
      }

      logger.info('Successfully created diff from workflow state', {
        blockCount: Object.keys(finalProposedState.blocks).length,
        edgeCount: finalProposedState.edges.length,
        hasLoops: Object.keys(finalProposedState.loops || {}).length > 0,
        hasParallels: Object.keys(finalProposedState.parallels || {}).length > 0,
        newBlocks: computed?.new_blocks?.length || 0,
        editedBlocks: computed?.edited_blocks?.length || 0,
        deletedBlocks: computed?.deleted_blocks?.length || 0,
        newEdges: computed?.edge_diff?.new_edges?.length || 0,
        deletedEdges: computed?.edge_diff?.deleted_edges?.length || 0,
        unchangedEdges: computed?.edge_diff?.unchanged_edges?.length || 0,
      })

      if (computed?.edge_diff?.deleted_edges && computed.edge_diff.deleted_edges.length > 0) {
        logger.info('Deleted edges detected:', {
          deletedEdges: computed.edge_diff.deleted_edges,
        })
      }

      return {
        success: true,
        diff: this.currentDiff,
      }
    } catch (error) {
      logger.error('Failed to create diff from workflow state:', error)
      return {
        success: false,
        errors: [
          error instanceof Error ? error.message : 'Failed to create diff from workflow state',
        ],
      }
    }
  }

  /**
   * Merge new workflow state into existing diff
   * Used for cumulative updates within the same message
   */
  async mergeDiff(jsonContent: string, diffAnalysis?: DiffAnalysis): Promise<DiffResult> {
    try {
      logger.info('Merging diff from workflow state')

      // If no existing diff, create a new one
      if (!this.currentDiff) {
        logger.info('No existing diff, creating new diff')
        return this.createDiff(jsonContent, diffAnalysis)
      }

      // Call the API route to merge the diff
      const body: any = {
        existingDiff: this.currentDiff,
        jsonContent,
      }

      if (diffAnalysis !== undefined && diffAnalysis !== null) {
        body.diffAnalysis = diffAnalysis
      }

      body.options = {
        applyAutoLayout: true,
        layoutOptions: {
          strategy: 'smart',
          direction: 'auto',
          spacing: {
            horizontal: 500,
            vertical: 400,
            layer: 700,
          },
          alignment: 'center',
          padding: {
            x: 250,
            y: 250,
          },
        },
      }

      const response = await fetch('/api/yaml/diff/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        logger.error('Failed to merge diff:', {
          status: response.status,
          error: errorData,
        })
        return {
          success: false,
          errors: [errorData?.error || `Failed to merge diff: ${response.statusText}`],
        }
      }

      const result = await response.json()

      if (!result.success || !result.diff) {
        return {
          success: false,
          errors: result.errors,
        }
      }

      // Update the current diff
      this.currentDiff = result.diff

      logger.info('Diff merged successfully', {
        totalBlocksCount: Object.keys(result.diff.proposedState.blocks).length,
        totalEdgesCount: result.diff.proposedState.edges.length,
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
  getCurrentDiff(): WorkflowDiff | undefined {
    return this.currentDiff
  }

  /**
   * Clear the current diff
   */
  clearDiff(): void {
    this.currentDiff = undefined
    logger.info('Diff cleared')
  }

  /**
   * Check if a diff is active
   */
  hasDiff(): boolean {
    return this.currentDiff !== undefined
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
      const cleanBlock: BlockState = { ...block }

      // Remove diff markers using proper typing
      const blockWithDiff = cleanBlock as BlockState & BlockWithDiff
      blockWithDiff.is_diff = undefined
      blockWithDiff.field_diffs = undefined

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
