import { createLogger } from '@/lib/logs/console/logger'
import { type StartBlockCandidate, StartBlockPath, TRIGGER_TYPES } from '@/lib/workflows/triggers'
import { getAllBlocks, getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const logger = createLogger('TriggerUtils')

/**
 * Generates mock data based on the output type definition
 */
function generateMockValue(type: string, description?: string, fieldName?: string): any {
  const name = fieldName || 'value'

  switch (type) {
    case 'string':
      return `mock_${name}`

    case 'number':
      return 42

    case 'boolean':
      return true

    case 'array':
      return [
        {
          id: 'item_1',
          name: 'Sample Item',
          value: 'Sample Value',
        },
      ]

    case 'json':
    case 'object':
      return {
        id: 'sample_id',
        name: 'Sample Object',
        status: 'active',
      }

    default:
      return null
  }
}

/**
 * Recursively processes nested output structures
 */
function processOutputField(key: string, field: any, depth = 0, maxDepth = 10): any {
  // Prevent infinite recursion
  if (depth > maxDepth) {
    return null
  }

  if (field && typeof field === 'object' && 'type' in field) {
    return generateMockValue(field.type, field.description, key)
  }

  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const nestedObject: Record<string, any> = {}
    for (const [nestedKey, nestedField] of Object.entries(field)) {
      nestedObject[nestedKey] = processOutputField(nestedKey, nestedField, depth + 1, maxDepth)
    }
    return nestedObject
  }

  return null
}

/**
 * Generates mock payload from outputs object
 */
function generateMockPayloadFromOutputs(outputs: Record<string, any>): Record<string, any> {
  const mockPayload: Record<string, any> = {}

  for (const [key, output] of Object.entries(outputs)) {
    if (key === 'visualization') {
      continue
    }
    mockPayload[key] = processOutputField(key, output)
  }

  return mockPayload
}

/**
 * Generates a mock payload based on outputs definition
 */
export function generateMockPayloadFromOutputsDefinition(
  outputs: Record<string, any>
): Record<string, any> {
  return generateMockPayloadFromOutputs(outputs)
}

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
        enableTriggerMode: hasTriggerCapability(block),
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
 * Check if a block has trigger capability (contains trigger mode subblocks)
 */
export function hasTriggerCapability(block: BlockConfig): boolean {
  const hasTriggerModeSubBlocks = block.subBlocks.some((subBlock) => subBlock.mode === 'trigger')

  if (block.category === 'triggers') {
    return hasTriggerModeSubBlocks
  }

  return (
    (block.triggers?.enabled === true && block.triggers.available.length > 0) ||
    hasTriggerModeSubBlocks
  )
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

  if (blockType === TRIGGER_TYPES.GENERIC_WEBHOOK) {
    return 'Webhook'
  }

  return block.name
}

/**
 * Groups triggers by their immediate downstream blocks to identify disjoint paths
 */
export function groupTriggersByPath<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(
  candidates: StartBlockCandidate<T>[],
  edges: Array<{ source: string; target: string }>
): Array<StartBlockCandidate<T>[]> {
  if (candidates.length <= 1) {
    return [candidates]
  }

  const groups: Array<StartBlockCandidate<T>[]> = []
  const processed = new Set<string>()

  // Build adjacency map (edges should already be filtered to exclude trigger-to-trigger)
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, [])
    }
    adjacency.get(edge.source)!.push(edge.target)
  }

  // Group triggers that feed into the same immediate blocks
  for (const trigger of candidates) {
    if (processed.has(trigger.blockId)) continue

    const immediateTargets = adjacency.get(trigger.blockId) || []
    const targetSet = new Set(immediateTargets)

    // Find all triggers with the same immediate targets
    const group = candidates.filter((t) => {
      if (processed.has(t.blockId)) return false
      if (t.blockId === trigger.blockId) return true

      const tTargets = adjacency.get(t.blockId) || []

      // Different number of targets = different paths
      if (immediateTargets.length !== tTargets.length) return false

      // Check if all targets match
      return tTargets.every((target) => targetSet.has(target))
    })

    group.forEach((t) => processed.add(t.blockId))
    groups.push(group)
  }

  logger.info('Grouped triggers by path', {
    groupCount: groups.length,
    groups: groups.map((g) => ({
      count: g.length,
      triggers: g.map((t) => ({ id: t.blockId, type: t.block.type })),
    })),
  })

  return groups
}

/**
 * Selects the best trigger from a list of candidates based on priority
 * Priority: Start Block > Schedules > External Triggers > Legacy
 * If multiple disjoint paths exist, returns one trigger per path
 */
export function selectBestTrigger<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[],
  edges?: Array<{ source: string; target: string }>
): StartBlockCandidate<T>[] {
  if (candidates.length === 0) {
    throw new Error('No trigger candidates provided')
  }

  // If edges provided, group by path and select best from each group
  if (edges) {
    const groups = groupTriggersByPath(candidates, edges)
    return groups.map((group) => selectBestFromGroup(group))
  }

  // Otherwise just select the single best trigger
  return [selectBestFromGroup(candidates)]
}

/**
 * Selects the best trigger from a group based on priority
 */
function selectBestFromGroup<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[]
): StartBlockCandidate<T> {
  if (candidates.length === 1) {
    return candidates[0]
  }

  // Sort by priority (lower number = higher priority)
  const sorted = [...candidates].sort((a, b) => {
    const getPriority = (trigger: StartBlockCandidate<T>): number => {
      // Start block - highest priority
      if (trigger.path === StartBlockPath.UNIFIED) return 0
      if (trigger.path === StartBlockPath.LEGACY_STARTER) return 1

      // For external triggers, differentiate schedules from webhooks
      if (trigger.path === StartBlockPath.EXTERNAL_TRIGGER) {
        if (trigger.block.type === 'schedule') return 2
        return 3 // Webhooks and other external triggers
      }

      // Other trigger types
      if (trigger.path === StartBlockPath.SPLIT_API) return 4
      if (trigger.path === StartBlockPath.SPLIT_INPUT) return 5
      if (trigger.path === StartBlockPath.SPLIT_MANUAL) return 6
      if (trigger.path === StartBlockPath.SPLIT_CHAT) return 7

      return 99 // Unknown
    }

    return getPriority(a) - getPriority(b)
  })

  const selected = sorted[0]
  logger.info('Selected best trigger from group', {
    selectedId: selected.blockId,
    selectedType: selected.block.type,
    selectedPath: selected.path,
    groupSize: candidates.length,
  })

  return selected
}

/**
 * Checks if a trigger needs mock payload (external triggers/webhooks, but not schedules)
 */
export function triggerNeedsMockPayload<T extends { type: string }>(
  trigger: StartBlockCandidate<T>
): boolean {
  // Only webhooks and external integrations need mock payloads
  // Schedules run normally without mock data
  return trigger.path === StartBlockPath.EXTERNAL_TRIGGER && trigger.block.type !== 'schedule'
}

/**
 * Extracts or generates mock payload for external trigger execution
 */
export function extractTriggerMockPayload<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(trigger: StartBlockCandidate<T>): any {
  const subBlocks = trigger.block.subBlocks as Record<string, any> | undefined

  // Determine the trigger ID
  let triggerId: string

  // Check for selectedTriggerId (multi-trigger blocks like Linear, Jira)
  if (typeof subBlocks?.selectedTriggerId?.value === 'string') {
    triggerId = subBlocks.selectedTriggerId.value
  } else {
    // For single-trigger blocks, get from block config
    const blockConfig = getBlock(trigger.block.type)

    if (blockConfig?.triggers?.available?.length === 1) {
      triggerId = blockConfig.triggers.available[0]
    } else {
      // Fallback to block type (for blocks that are themselves triggers like schedule)
      triggerId = trigger.block.type
    }
  }

  try {
    const triggerConfig = getTrigger(triggerId)

    if (!triggerConfig || !triggerConfig.outputs) {
      logger.warn('No trigger config or outputs found', {
        triggerId,
        blockId: trigger.blockId,
      })
      return {}
    }

    const payload = generateMockPayloadFromOutputsDefinition(triggerConfig.outputs)

    logger.info('Generated mock payload from trigger outputs', {
      triggerId,
      blockId: trigger.blockId,
      topLevelKeys: Object.keys(payload ?? {}),
    })

    return payload
  } catch (error) {
    logger.error('Failed to generate mock payload from trigger outputs', {
      triggerId,
      blockId: trigger.blockId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}
