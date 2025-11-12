import { getBlock } from '@/blocks'

/**
 * Unified trigger type definitions
 */
export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  GENERIC_WEBHOOK: 'generic_webhook',
  SCHEDULE: 'schedule',
  START: 'start_trigger',
  STARTER: 'starter', // Legacy
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]

export enum StartBlockPath {
  UNIFIED = 'unified_start',
  LEGACY_STARTER = 'legacy_starter',
  SPLIT_INPUT = 'legacy_input_trigger',
  SPLIT_API = 'legacy_api_trigger',
  SPLIT_CHAT = 'legacy_chat_trigger',
  SPLIT_MANUAL = 'legacy_manual_trigger',
  EXTERNAL_TRIGGER = 'external_trigger',
}

type StartExecutionKind = 'chat' | 'manual' | 'api'

const EXECUTION_PRIORITIES: Record<StartExecutionKind, StartBlockPath[]> = {
  chat: [StartBlockPath.UNIFIED, StartBlockPath.SPLIT_CHAT, StartBlockPath.LEGACY_STARTER],
  manual: [
    StartBlockPath.UNIFIED,
    StartBlockPath.SPLIT_API,
    StartBlockPath.SPLIT_INPUT,
    StartBlockPath.SPLIT_MANUAL,
    StartBlockPath.LEGACY_STARTER,
    StartBlockPath.EXTERNAL_TRIGGER,
  ],
  api: [
    StartBlockPath.UNIFIED,
    StartBlockPath.SPLIT_API,
    StartBlockPath.SPLIT_INPUT,
    StartBlockPath.LEGACY_STARTER,
  ],
}

const CHILD_PRIORITIES: StartBlockPath[] = [
  StartBlockPath.UNIFIED,
  StartBlockPath.SPLIT_INPUT,
  StartBlockPath.LEGACY_STARTER,
]

const START_CONFLICT_TYPES: TriggerType[] = [
  TRIGGER_TYPES.START,
  TRIGGER_TYPES.API,
  TRIGGER_TYPES.INPUT,
  TRIGGER_TYPES.MANUAL,
  TRIGGER_TYPES.CHAT,
  TRIGGER_TYPES.STARTER, // Legacy starter also conflicts with start_trigger
]

type BlockWithType = { type: string; subBlocks?: Record<string, unknown> | undefined }

type BlockWithMetadata = BlockWithType & {
  category?: string
  triggers?: { enabled?: boolean }
}

export interface StartBlockCandidate<T extends BlockWithType> {
  blockId: string
  block: T
  path: StartBlockPath
}

type ClassifyStartOptions = {
  category?: string
  triggerModeEnabled?: boolean
}

export function classifyStartBlockType(
  type: string,
  opts?: ClassifyStartOptions
): StartBlockPath | null {
  switch (type) {
    case TRIGGER_TYPES.START:
      return StartBlockPath.UNIFIED
    case TRIGGER_TYPES.STARTER:
      return StartBlockPath.LEGACY_STARTER
    case TRIGGER_TYPES.INPUT:
      return StartBlockPath.SPLIT_INPUT
    case TRIGGER_TYPES.API:
      return StartBlockPath.SPLIT_API
    case TRIGGER_TYPES.CHAT:
      return StartBlockPath.SPLIT_CHAT
    case TRIGGER_TYPES.MANUAL:
      return StartBlockPath.SPLIT_MANUAL
    case TRIGGER_TYPES.WEBHOOK:
    case TRIGGER_TYPES.SCHEDULE:
      return StartBlockPath.EXTERNAL_TRIGGER
    default:
      if (opts?.category === 'triggers' || opts?.triggerModeEnabled) {
        return StartBlockPath.EXTERNAL_TRIGGER
      }
      return null
  }
}

export function classifyStartBlock<T extends BlockWithType>(block: T): StartBlockPath | null {
  const blockWithMetadata = block as BlockWithMetadata

  // Try to get metadata from the block itself first
  let category = blockWithMetadata.category
  let triggerModeEnabled = Boolean(blockWithMetadata.triggers?.enabled)

  // If not available on the block, fetch from registry
  if (!category || triggerModeEnabled === undefined) {
    const blockConfig = getBlock(block.type)
    if (blockConfig) {
      category = category || blockConfig.category
      triggerModeEnabled = triggerModeEnabled || Boolean(blockConfig.triggers?.enabled)
    }
  }

  return classifyStartBlockType(block.type, { category, triggerModeEnabled })
}

export function isLegacyStartPath(path: StartBlockPath): boolean {
  return path !== StartBlockPath.UNIFIED
}

function toEntries<T extends BlockWithType>(blocks: Record<string, T> | T[]): Array<[string, T]> {
  if (Array.isArray(blocks)) {
    return blocks.map((block, index) => {
      const potentialId = (block as { id?: unknown }).id
      const inferredId = typeof potentialId === 'string' ? potentialId : `${index}`
      return [inferredId, block]
    })
  }
  return Object.entries(blocks)
}

type ResolveStartOptions = {
  execution: StartExecutionKind
  isChildWorkflow?: boolean
  allowLegacyStarter?: boolean
}

function supportsExecution(path: StartBlockPath, execution: StartExecutionKind): boolean {
  if (path === StartBlockPath.UNIFIED || path === StartBlockPath.LEGACY_STARTER) {
    return true
  }

  if (execution === 'chat') {
    return path === StartBlockPath.SPLIT_CHAT
  }

  if (execution === 'api') {
    return path === StartBlockPath.SPLIT_API || path === StartBlockPath.SPLIT_INPUT
  }

  return (
    path === StartBlockPath.SPLIT_API ||
    path === StartBlockPath.SPLIT_INPUT ||
    path === StartBlockPath.SPLIT_MANUAL ||
    path === StartBlockPath.EXTERNAL_TRIGGER
  )
}

export function resolveStartCandidates<T extends BlockWithType>(
  blocks: Record<string, T> | T[],
  options: ResolveStartOptions
): StartBlockCandidate<T>[] {
  const entries = toEntries(blocks)
  if (entries.length === 0) return []

  const priorities = options.isChildWorkflow
    ? CHILD_PRIORITIES
    : EXECUTION_PRIORITIES[options.execution]

  const candidates: StartBlockCandidate<T>[] = []

  for (const [blockId, block] of entries) {
    const path = classifyStartBlock(block)
    if (!path) continue

    if (options.isChildWorkflow) {
      if (!CHILD_PRIORITIES.includes(path)) {
        continue
      }
    } else if (!supportsExecution(path, options.execution)) {
      continue
    }

    if (path === StartBlockPath.LEGACY_STARTER && options.allowLegacyStarter === false) {
      continue
    }

    candidates.push({ blockId, block, path })
  }

  candidates.sort((a, b) => {
    const order = options.isChildWorkflow ? CHILD_PRIORITIES : priorities
    const aIdx = order.indexOf(a.path)
    const bIdx = order.indexOf(b.path)
    if (aIdx === -1 && bIdx === -1) return 0
    if (aIdx === -1) return 1
    if (bIdx === -1) return -1
    return aIdx - bIdx
  })

  return candidates
}

type SubBlockWithValue = { value?: unknown }

function readSubBlockValue(subBlocks: Record<string, unknown> | undefined, key: string): unknown {
  const raw = subBlocks?.[key]
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return (raw as SubBlockWithValue).value
  }
  return undefined
}

export function getLegacyStarterMode(block: {
  subBlocks?: Record<string, unknown>
}): 'manual' | 'api' | 'chat' | null {
  const modeValue = readSubBlockValue(block.subBlocks, 'startWorkflow')
  if (modeValue === 'chat') return 'chat'
  if (modeValue === 'api' || modeValue === 'run') return 'api'
  if (modeValue === undefined || modeValue === 'manual') return 'manual'
  return null
}

/**
 * Mapping from reference alias (used in inline refs like <api.*>, <chat.*>, etc.)
 * to concrete trigger block type identifiers used across the system.
 */
export const TRIGGER_REFERENCE_ALIAS_MAP = {
  start: TRIGGER_TYPES.START,
  api: TRIGGER_TYPES.API,
  chat: TRIGGER_TYPES.CHAT,
  manual: TRIGGER_TYPES.START,
} as const

export type TriggerReferenceAlias = keyof typeof TRIGGER_REFERENCE_ALIAS_MAP

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
    return Object.values(TRIGGER_TYPES).includes(type as TriggerType)
  }

  /**
   * Check if a block is a chat-compatible trigger
   */
  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.CHAT || block.type === TRIGGER_TYPES.START) {
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
    if (
      block.type === TRIGGER_TYPES.INPUT ||
      block.type === TRIGGER_TYPES.MANUAL ||
      block.type === TRIGGER_TYPES.START
    ) {
      return true
    }

    // Legacy: starter block in manual mode or without explicit mode (default to manual)
    if (block.type === TRIGGER_TYPES.STARTER) {
      // If startWorkflow is not set or is set to 'manual', treat as manual trigger
      const startWorkflowValue = block.subBlocks?.startWorkflow?.value
      return startWorkflowValue === 'manual' || startWorkflowValue === undefined
    }

    return false
  }

  /**
   * Check if a block is an API-compatible trigger
   * @param block - Block to check
   * @param isChildWorkflow - Whether this is being called from a child workflow context
   */
  static isApiTrigger(block: { type: string; subBlocks?: any }, isChildWorkflow = false): boolean {
    if (isChildWorkflow) {
      // Child workflows (workflow-in-workflow) support legacy input trigger and new start block
      return block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.START
    }
    // Direct API calls work with api_trigger and the new start block
    if (block.type === TRIGGER_TYPES.API || block.type === TRIGGER_TYPES.START) {
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
      if (triggerType === TRIGGER_TYPES.GENERIC_WEBHOOK) {
        return 'Webhook'
      }
      return block.name
    }

    // Fallback for legacy or unknown types
    switch (triggerType) {
      case TRIGGER_TYPES.CHAT:
        return 'Chat'
      case TRIGGER_TYPES.INPUT:
        return 'Input Trigger'
      case TRIGGER_TYPES.MANUAL:
        return 'Manual'
      case TRIGGER_TYPES.API:
        return 'API'
      case TRIGGER_TYPES.START:
        return 'Start'
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
    triggerType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): T[] {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    switch (triggerType) {
      case 'chat':
        return blockArray.filter((block) => TriggerUtils.isChatTrigger(block))
      case 'manual':
        return blockArray.filter((block) => TriggerUtils.isManualTrigger(block))
      case 'api':
        return blockArray.filter((block) => TriggerUtils.isApiTrigger(block, isChildWorkflow))
      default:
        return []
    }
  }

  /**
   * Find the appropriate start block for a given execution context
   */
  static findStartBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): (StartBlockCandidate<T> & { block: T }) | null {
    const candidates = resolveStartCandidates(blocks, {
      execution: executionType,
      isChildWorkflow,
    })

    if (candidates.length === 0) {
      return null
    }

    const [primary] = candidates
    return primary
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
    // Each trigger type can only have one instance of itself
    // Manual and Input Form can coexist
    // API, Chat triggers must be unique
    // Schedules and webhooks can have multiple instances
    return (
      triggerType === TRIGGER_TYPES.API ||
      triggerType === TRIGGER_TYPES.INPUT ||
      triggerType === TRIGGER_TYPES.MANUAL ||
      triggerType === TRIGGER_TYPES.CHAT ||
      triggerType === TRIGGER_TYPES.START
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
    const hasLegacyStarter = TriggerUtils.hasLegacyStarter(blocks)

    // Legacy starter block can't coexist with Chat, Input, Manual, or API triggers
    if (hasLegacyStarter) {
      if (
        triggerType === TRIGGER_TYPES.CHAT ||
        triggerType === TRIGGER_TYPES.INPUT ||
        triggerType === TRIGGER_TYPES.MANUAL ||
        triggerType === TRIGGER_TYPES.API ||
        triggerType === TRIGGER_TYPES.START
      ) {
        return true
      }
    }

    if (triggerType === TRIGGER_TYPES.STARTER) {
      const hasModernTriggers = blockArray.some(
        (block) =>
          block.type === TRIGGER_TYPES.CHAT ||
          block.type === TRIGGER_TYPES.INPUT ||
          block.type === TRIGGER_TYPES.MANUAL ||
          block.type === TRIGGER_TYPES.API ||
          block.type === TRIGGER_TYPES.START
      )
      if (hasModernTriggers) {
        return true
      }
    }

    // Start trigger cannot coexist with other single-instance trigger types
    if (triggerType === TRIGGER_TYPES.START) {
      return blockArray.some((block) => START_CONFLICT_TYPES.includes(block.type as TriggerType))
    }

    // Only one Input trigger allowed
    if (triggerType === TRIGGER_TYPES.INPUT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.INPUT)
    }

    // Only one Manual trigger allowed
    if (triggerType === TRIGGER_TYPES.MANUAL) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.MANUAL)
    }

    // Only one API trigger allowed
    if (triggerType === TRIGGER_TYPES.API) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.API)
    }

    // Chat trigger must be unique
    if (triggerType === TRIGGER_TYPES.CHAT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.CHAT)
    }

    // Centralized rule: only API, Input, Chat are single-instance
    if (!TriggerUtils.requiresSingleInstance(triggerType)) {
      return false
    }

    return blockArray.some((block) => block.type === triggerType)
  }

  /**
   * Evaluate whether adding a trigger of the given type is allowed and, if not, why.
   * Returns null if allowed; otherwise returns an object describing the violation.
   * This avoids duplicating UI logic across toolbar/drop handlers.
   */
  static getTriggerAdditionIssue<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): { issue: 'legacy' | 'duplicate'; triggerName: string } | null {
    if (!TriggerUtils.wouldViolateSingleInstance(blocks, triggerType)) {
      return null
    }

    // Legacy starter present + adding modern trigger → legacy incompatibility
    if (TriggerUtils.hasLegacyStarter(blocks) && TriggerUtils.isAnyTriggerType(triggerType)) {
      return { issue: 'legacy', triggerName: 'new trigger' }
    }

    // Otherwise treat as duplicate of a single-instance trigger
    const triggerName = TriggerUtils.getDefaultTriggerName(triggerType) || 'trigger'
    return { issue: 'duplicate', triggerName }
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

  /**
   * Check if a block is inside a loop or parallel subflow
   * @param blockId - ID of the block to check
   * @param blocks - Record of all blocks in the workflow
   * @returns true if the block is inside a loop or parallel, false otherwise
   */
  static isBlockInSubflow<T extends { id: string; data?: { parentId?: string } }>(
    blockId: string,
    blocks: T[] | Record<string, T>
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    const block = blockArray.find((b) => b.id === blockId)

    if (!block || !block.data?.parentId) {
      return false
    }

    // Check if the parent is a loop or parallel block
    const parent = blockArray.find((b) => b.id === block.data?.parentId)
    if (!parent) {
      return false
    }

    // Type-safe check: parent must have a 'type' property
    const parentWithType = parent as T & { type?: string }
    return parentWithType.type === 'loop' || parentWithType.type === 'parallel'
  }
}
