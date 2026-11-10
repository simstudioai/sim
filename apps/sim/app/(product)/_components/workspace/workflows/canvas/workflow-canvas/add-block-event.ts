import type { PendingConnect } from '@/app/(product)/_components/workspace/workflows/canvas/connection-block-selector/connection-block-selector'

/** The window event that asks the open canvas to add a block. */
export const ADD_BLOCK_EVENT = 'add-block-from-toolbar'

export interface AddBlockDetail {
  type: string
  enableTriggerMode?: boolean
  presetOperation?: string
  /** An edge drag-release: the handle the new block connects from and where it was released. */
  pendingConnect?: PendingConnect
}

/** Asks the open canvas to add a block. */
export function dispatchAddBlock(detail: AddBlockDetail) {
  window.dispatchEvent(new CustomEvent<AddBlockDetail>(ADD_BLOCK_EVENT, { detail }))
}
