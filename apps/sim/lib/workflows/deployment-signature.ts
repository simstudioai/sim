import type { Edge } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Deployment Signature Module
 *
 * This module provides utilities to create a "deployment signature" from workflow state.
 * The signature only includes properties that are relevant for deployment decisions,
 * excluding UI-only changes such as:
 * - Block positions
 * - Layout measurements (width, height)
 * - UI state (expanded/collapsed states)
 * - Test values
 *
 * This ensures that the workflow redeployment check (via /api/workflows/[id]/status)
 * is only triggered by meaningful changes that would actually require redeployment,
 * not by UI interactions like moving blocks, opening/closing tools, etc.
 *
 * The normalization logic mirrors the hasWorkflowChanged function in @/lib/workflows/utils
 * to ensure consistency between change detection and actual deployment checks.
 */

/**
 * Extracts deployment-relevant properties from a block, excluding UI-only changes
 * This mirrors the logic in hasWorkflowChanged to ensure consistency
 */
function normalizeBlockForSignature(block: BlockState): Record<string, any> {
  const {
    position: _pos,
    layout: _layout,
    height: _height,
    subBlocks = {},
    ...rest
  } = block

  // Exclude width/height from data object (container dimensions from autolayout)
  const { width: _width, height: _dataHeight, ...dataRest } = rest.data || {}

  // For subBlocks, we need to extract just the values
  const normalizedSubBlocks: Record<string, any> = {}
  for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
    // Special handling for tools subBlock - exclude UI-only 'isExpanded' field
    if (subBlockId === 'tools' && Array.isArray(subBlock.value)) {
      normalizedSubBlocks[subBlockId] = subBlock.value.map((tool: any) => {
        if (tool && typeof tool === 'object') {
          const { isExpanded: _isExpanded, ...toolRest } = tool
          return toolRest
        }
        return tool
      })
    } else if (subBlockId === 'inputFormat' && Array.isArray(subBlock.value)) {
      // Handle inputFormat - exclude collapsed state and test values
      normalizedSubBlocks[subBlockId] = subBlock.value.map((field: any) => {
        if (field && typeof field === 'object') {
          const { value: _value, collapsed: _collapsed, ...fieldRest } = field
          return fieldRest
        }
        return field
      })
    } else {
      normalizedSubBlocks[subBlockId] = subBlock.value
    }
  }

  return {
    ...rest,
    data: dataRest,
    subBlocks: normalizedSubBlocks,
  }
}

/**
 * Extracts deployment-relevant properties from an edge
 */
function normalizeEdgeForSignature(edge: Edge): Record<string, any> {
  return {
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  }
}

/**
 * Creates a deployment signature from workflow state that only includes
 * properties that would trigger a redeployment. UI-only changes like
 * position, layout, expanded states, etc. are excluded.
 *
 * @param blocks - Current blocks from workflow store
 * @param edges - Current edges from workflow store
 * @param subBlockValues - Current subblock values from subblock store
 * @returns A stringified signature that changes only when deployment-relevant changes occur
 */
export function createDeploymentSignature(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  subBlockValues: Record<string, any> | null
): string {
  // Normalize blocks (excluding UI-only properties)
  const normalizedBlocks: Record<string, any> = {}
  for (const [blockId, block] of Object.entries(blocks)) {
    normalizedBlocks[blockId] = normalizeBlockForSignature(block)
  }

  // Normalize edges (only connection information)
  const normalizedEdges = edges
    .map(normalizeEdgeForSignature)
    .sort((a, b) =>
      `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
        `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
      )
    )

  // Create signature object
  const signature = {
    blockIds: Object.keys(blocks).sort(),
    blocks: normalizedBlocks,
    edges: normalizedEdges,
    subBlockValues: subBlockValues || {},
  }

  return JSON.stringify(signature)
}
