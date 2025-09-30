import { getAllBlocks, getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'

export interface TriggerInfo {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  category: 'core' | 'integration'
  enableTriggerMode?: boolean
}

/**
 * Get all blocks that can act as triggers
 * This includes both dedicated trigger blocks and tools with trigger capabilities
 */
export function getAllTriggerBlocks(): TriggerInfo[] {
  const allBlocks = getAllBlocks()
  const triggers: TriggerInfo[] = []

  for (const block of allBlocks) {
    // Skip hidden blocks
    if (block.hideFromToolbar) continue

    // Check if it's a core trigger block (category: 'triggers')
    if (block.category === 'triggers') {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description,
        icon: block.icon,
        color: block.bgColor,
        category: 'core',
      })
    }
    // Check if it's a tool with trigger capability (has trigger-config subblock)
    else if (hasTriggerCapability(block)) {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description.replace(' or trigger workflows from ', ', trigger from '),
        icon: block.icon,
        color: block.bgColor,
        category: 'integration',
        enableTriggerMode: true,
      })
    }
  }

  // Sort: core triggers first, then integration triggers, alphabetically within each category
  return triggers.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === 'core' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

/**
 * Check if a block has trigger capability (contains a trigger-config subblock)
 */
export function hasTriggerCapability(block: BlockConfig): boolean {
  return block.subBlocks.some((subBlock) => subBlock.type === 'trigger-config')
}

/**
 * Get blocks that should appear in the triggers tab
 * This includes all trigger blocks and tools with trigger mode
 */
export function getTriggersForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    // Include blocks with triggers category or trigger-config subblock
    return block.category === 'triggers' || hasTriggerCapability(block)
  })
}

/**
 * Get blocks that should appear in the blocks tab
 * This excludes only dedicated trigger blocks, not tools with trigger capability
 */
export function getBlocksForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    if (block.type === 'starter') return false // Legacy block
    // Only exclude blocks with 'triggers' category
    // Tools with trigger capability should still appear in blocks tab
    return block.category !== 'triggers'
  })
}

/**
 * Get the proper display name for a trigger block in the UI
 */
export function getTriggerDisplayName(blockType: string): string {
  const block = getBlock(blockType)
  if (!block) return blockType

  // Special case for generic_webhook - show as "Webhook" in UI
  if (blockType === 'generic_webhook') {
    return 'Webhook'
  }

  return block.name
}
