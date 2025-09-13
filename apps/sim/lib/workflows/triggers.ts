import { getBlock } from '@/blocks'

/**
 * Unified trigger type definitions
 */
export const TRIGGER_TYPES = {
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  STARTER: 'starter', // Legacy
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]

/**
 * Trigger classification and utilities
 */
export class TriggerUtils {
  /**
   * Check if a block is any kind of trigger
   */
  static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean {
    const blockConfig = getBlock(block.type)

    return (
      // New trigger blocks (explicit category)
      blockConfig?.category === 'triggers' ||
      // Blocks with trigger mode enabled
      block.triggerMode === true ||
      // Legacy starter block
      block.type === TRIGGER_TYPES.STARTER
    )
  }

  /**
   * Check if a block is a specific trigger type
   */
  static isTriggerType(block: { type: string }, triggerType: TriggerType): boolean {
    return block.type === triggerType
  }

  /**
   * Check if a type string is any trigger type
   */
  static isAnyTriggerType(type: string): boolean {
    return (
      type === TRIGGER_TYPES.MANUAL ||
      type === TRIGGER_TYPES.CHAT ||
      type === TRIGGER_TYPES.API ||
      type === TRIGGER_TYPES.WEBHOOK ||
      type === TRIGGER_TYPES.SCHEDULE
    )
  }

  /**
   * Check if a block is a chat-compatible trigger
   */
  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.CHAT) {
      return true
    }

    // Legacy: starter block in chat mode
    if (block.type === TRIGGER_TYPES.STARTER) {
      return block.subBlocks?.startWorkflow?.value === 'chat'
    }

    return false
  }

  /**
   * Check if a block is a manual-compatible trigger
   */
  static isManualTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.MANUAL) {
      return true
    }

    // Legacy: starter block in manual mode
    if (block.type === TRIGGER_TYPES.STARTER) {
      return block.subBlocks?.startWorkflow?.value === 'manual'
    }

    return false
  }

  /**
   * Check if a block is an API-compatible trigger
   */
  static isApiTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.API) {
      return true
    }

    // Legacy: starter block in API mode
    if (block.type === TRIGGER_TYPES.STARTER) {
      const mode = block.subBlocks?.startWorkflow?.value
      return mode === 'api' || mode === 'run'
    }

    return false
  }

  /**
   * Get the default name for a trigger type
   */
  static getDefaultTriggerName(triggerType: string): string | null {
    // Use the block's actual name from the registry
    const block = getBlock(triggerType)
    if (block) {
      // Special case for generic_webhook - show as "Webhook" in UI
      if (triggerType === 'generic_webhook') {
        return 'Webhook'
      }
      return block.name
    }

    // Fallback for legacy or unknown types
    switch (triggerType) {
      case TRIGGER_TYPES.CHAT:
        return 'Chat'
      case TRIGGER_TYPES.MANUAL:
        return 'Manual'
      case TRIGGER_TYPES.API:
        return 'API'
      case TRIGGER_TYPES.WEBHOOK:
        return 'Webhook'
      case TRIGGER_TYPES.SCHEDULE:
        return 'Schedule'
      default:
        return null
    }
  }

  /**
   * Find trigger blocks of a specific type in a workflow
   */
  static findTriggersByType<T extends { type: string; subBlocks?: any }>(
    blocks: T[] | Record<string, T>,
    triggerType: 'chat' | 'manual' | 'api'
  ): T[] {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    switch (triggerType) {
      case 'chat':
        return blockArray.filter((block) => TriggerUtils.isChatTrigger(block))
      case 'manual':
        return blockArray.filter((block) => TriggerUtils.isManualTrigger(block))
      case 'api':
        return blockArray.filter((block) => TriggerUtils.isApiTrigger(block))
      default:
        return []
    }
  }

  /**
   * Find the appropriate start block for a given execution context
   */
  static findStartBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api'
  ): { blockId: string; block: T } | null {
    const entries = Object.entries(blocks)

    // Look for new trigger blocks first
    const triggers = TriggerUtils.findTriggersByType(blocks, executionType)
    if (triggers.length > 0) {
      const blockId = entries.find(([, b]) => b === triggers[0])?.[0]
      if (blockId) {
        return { blockId, block: triggers[0] }
      }
    }

    // Legacy fallback: look for starter block
    const starterEntry = entries.find(([, block]) => block.type === TRIGGER_TYPES.STARTER)
    if (starterEntry) {
      return { blockId: starterEntry[0], block: starterEntry[1] }
    }

    return null
  }

  /**
   * Check if multiple triggers of a restricted type exist
   */
  static hasMultipleTriggers<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: TriggerType
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    const count = blockArray.filter((block) => block.type === triggerType).length
    return count > 1
  }

  /**
   * Check if a trigger type requires single instance constraint
   */
  static requiresSingleInstance(triggerType: string): boolean {
    return (
      triggerType === TRIGGER_TYPES.API ||
      triggerType === TRIGGER_TYPES.MANUAL ||
      triggerType === TRIGGER_TYPES.CHAT
    )
  }

  /**
   * Check if a workflow has a legacy starter block
   */
  static hasLegacyStarter<T extends { type: string }>(blocks: T[] | Record<string, T>): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    return blockArray.some((block) => block.type === TRIGGER_TYPES.STARTER)
  }

  /**
   * Check if adding a trigger would violate single instance constraint
   */
  static wouldViolateSingleInstance<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    // Can't add new triggers if legacy starter block exists
    if (TriggerUtils.hasLegacyStarter(blocks) && TriggerUtils.isAnyTriggerType(triggerType)) {
      return true
    }

    // Check single-instance rules
    if (!TriggerUtils.requiresSingleInstance(triggerType)) {
      return false
    }

    return blockArray.some((block) => block.type === triggerType)
  }

  /**
   * Get trigger validation message
   */
  static getTriggerValidationMessage(
    triggerType: 'chat' | 'manual' | 'api',
    issue: 'missing' | 'multiple'
  ): string {
    const triggerName = triggerType.charAt(0).toUpperCase() + triggerType.slice(1)

    if (issue === 'missing') {
      return `${triggerName} execution requires a ${triggerName} Trigger block`
    }

    return `Multiple ${triggerName} Trigger blocks found. Keep only one.`
  }
}
