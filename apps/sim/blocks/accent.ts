import type { ComponentType } from 'react'
import { Repeat, Split } from '@sim/emcn/icons'
import { hasWorkflowTypeRole } from '@sim/workflow-renderer'
import { getBlock } from '@/blocks/registry'

/** Tile fill for a block that has no config of its own to colour it. */
export const DEFAULT_BLOCK_TILE_COLOR = '#6B7280'

/**
 * Subflow tiles. Loop and Parallel are canvas blocks with no registry config,
 * so every surface that lists them had to special-case the pair; they resolve
 * here instead.
 */
const SUBFLOW_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  loop: Repeat,
  parallel: Split,
}

/**
 * Whether a block's tile takes the canvas role accent rather than the block's
 * own provider colour. This is the canvas's own rule, read from one place so
 * every surface that lists a block agrees with the card it names: only a
 * third-party integration wears its brand, everything first-party wears its
 * role accent — landing on `neutral` when the role map has no entry yet,
 * exactly as the canvas does.
 *
 * Keying off the catalog `bgColor` instead is what made a palette row
 * contradict the card it was about to place: `generic_webhook` is catalogued
 * green but is an `interface` block on the canvas, and the five roleless
 * first-party triggers (`api_trigger`, `chat_trigger`, `circleback`,
 * `input_trigger`, `manual_trigger`) are neutral there while their configs
 * carry blues and a gradient.
 *
 * A type with no config at all falls back to role membership, which accents the
 * subflows (`loop`, `parallel`, `workflow`) and leaves the terminal's
 * synthesized `error`/`validation`/`cancelled` rows on their status fill.
 */
export function hasBlockAccent(blockType: string): boolean {
  const config = getBlock(blockType)
  return config ? config.category !== 'tools' : hasWorkflowTypeRole(blockType)
}

/** A block's tile icon, including the subflows that carry no registry config. */
export function getBlockTileIcon(
  blockType: string
): ComponentType<{ className?: string }> | undefined {
  return getBlock(blockType)?.icon ?? SUBFLOW_ICONS[blockType]
}

/** A block's provider tile fill. Only reached when it takes no accent. */
export function getBlockTileColor(blockType: string): string {
  return getBlock(blockType)?.bgColor || DEFAULT_BLOCK_TILE_COLOR
}
