/**
 * Canvas layout: the block fields the canvas writes (a drag, a resize, a handle flip, a measured
 * height) that never change what a workflow runs. Source never prints them; the lock carries them
 * as `layout` ({@link layoutOf}), and every comparison of "what changed" ignores them.
 *
 * Client-safe: the Code tab imports it to tell a drag from an edit, so it imports types only.
 */
import type { BlockState } from '@sim/workflow-types/workflow'
import type { LockLayout } from './lock'

/** Top-level block fields that only place a block on the canvas. */
export const BLOCK_LAYOUT_FIELDS = ['position', 'height', 'layout', 'horizontalHandles'] as const

/** `block.data` fields that only size a block on the canvas. */
export const BLOCK_LAYOUT_DATA_FIELDS = ['width', 'height'] as const

/** A block's canvas layout, as the lock records it. */
export function layoutOf(block: BlockState): LockLayout {
  const layout: LockLayout = { x: block.position?.x ?? 0, y: block.position?.y ?? 0 }
  const data = block.data ?? {}
  if (typeof data.width === 'number') layout.w = data.width
  if (typeof data.height === 'number') layout.h = data.height
  if (typeof block.height === 'number') layout.height = block.height
  if (typeof block.horizontalHandles === 'boolean')
    layout.horizontalHandles = block.horizontalHandles
  return layout
}
