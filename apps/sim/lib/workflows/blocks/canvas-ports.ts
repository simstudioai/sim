import {
  getWorkflowSubflowHandleIds,
  WORKFLOW_ERROR_HANDLE_ID,
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
} from '@sim/workflow-types/workflow'
import { showsCanvasDefaultHandles, showsCanvasErrorRow } from '@/lib/workflows/blocks/canvas-rows'
import { getDynamicHandleRows } from '@/lib/workflows/dynamic-handle-topology'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** A mounted canvas port, including the snapshot label used for a removed port. */
export interface CanvasPort {
  handleId: string
  type: 'source' | 'target'
  title: string
  value: string
}

export type CanvasPortBlock = Pick<BlockState, 'id' | 'type' | 'triggerMode' | 'errorEnabled'> & {
  subBlocks: Record<string, { value: unknown }>
}

/** Ports in mount order, which also determines React Flow's implicit handle selection. */
export function getCanvasPorts(block: CanvasPortBlock, hasErrorConnection = false): CanvasPort[] {
  const input: CanvasPort = {
    handleId: WORKFLOW_TARGET_HANDLE_ID,
    type: 'target',
    title: 'Input',
    value: '',
  }
  if (block.type === 'loop' || block.type === 'parallel') {
    const { start, end } = getWorkflowSubflowHandleIds(block.type)
    return [
      { handleId: start, type: 'source', title: 'Start', value: '' },
      input,
      { handleId: end, type: 'source', title: 'End', value: '' },
    ]
  }
  const config = getBlock(block.type)
  if (!config || block.type === 'note') return []

  const ports: CanvasPort[] = []
  if (showsCanvasDefaultHandles(config, block.type, block.triggerMode === true)) {
    ports.push(input)
  }
  if (block.type === 'condition' || block.type === 'router_v2') {
    ports.push(...getDynamicHandleRows(block).map((row) => ({ ...row, type: 'source' as const })))
  } else if (block.type !== 'response') {
    ports.push({ handleId: WORKFLOW_SOURCE_HANDLE_ID, type: 'source', title: 'Output', value: '' })
  }
  if (
    showsCanvasErrorRow(config, block.type, block.triggerMode === true) &&
    (block.errorEnabled || hasErrorConnection)
  ) {
    ports.push({ handleId: WORKFLOW_ERROR_HANDLE_ID, type: 'source', title: 'Error', value: '' })
  }
  return ports
}
