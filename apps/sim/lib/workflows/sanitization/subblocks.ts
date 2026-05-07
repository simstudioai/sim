import { createLogger } from '@sim/logger'
import { DEFAULT_SUBBLOCK_TYPE } from '@sim/workflow-persistence/subblocks'
import { isPlainRecord } from '@/lib/core/utils/records'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowSubblockSanitization')

interface SanitizeMalformedSubBlocksOptions {
  convertEmptyStringToNull?: boolean
}

interface SanitizableBlock {
  id: string
  type: string
  subBlocks?: Record<string, unknown>
}

/**
 * Repairs legacy subBlock metadata when the map key identifies a real field,
 * and drops entries that cannot be associated with a stable subBlock.
 */
export function sanitizeMalformedSubBlocks(
  block: SanitizableBlock,
  options: SanitizeMalformedSubBlocksOptions = {}
): { subBlocks: Record<string, BlockState['subBlocks'][string]>; changed: boolean } {
  let changed = false
  const blockConfig = getBlock(block.type)
  const result: Record<string, BlockState['subBlocks'][string]> = {}

  for (const [subBlockId, subBlock] of Object.entries(block.subBlocks || {})) {
    if (subBlockId === 'undefined') {
      logger.warn('Skipping malformed subBlock with key "undefined"', { blockId: block.id })
      changed = true
      continue
    }

    const configuredType = blockConfig?.subBlocks?.find((config) => config.id === subBlockId)?.type

    if (!isPlainRecord(subBlock)) {
      if (!configuredType) {
        logger.warn('Skipping malformed subBlock: unrecognized value entry', {
          blockId: block.id,
          subBlockId,
        })
        changed = true
        continue
      }

      logger.warn('Repairing malformed subBlock value', { blockId: block.id, subBlockId })
      result[subBlockId] = {
        id: subBlockId,
        type: configuredType || DEFAULT_SUBBLOCK_TYPE,
        value: options.convertEmptyStringToNull && subBlock === '' ? null : subBlock,
      } as BlockState['subBlocks'][string]
      changed = true
      continue
    }

    if (subBlock.type === 'unknown' && !configuredType) {
      logger.warn('Skipping malformed subBlock: type is "unknown"', {
        blockId: block.id,
        subBlockId,
      })
      changed = true
      continue
    }

    const id = typeof subBlock.id === 'string' && subBlock.id.length > 0 ? subBlock.id : subBlockId
    const typeFromConfig =
      configuredType || blockConfig?.subBlocks?.find((config) => config.id === id)?.type
    const missingMetadata =
      typeof subBlock.id !== 'string' ||
      subBlock.id.length === 0 ||
      typeof subBlock.type !== 'string' ||
      subBlock.type.length === 0

    if (missingMetadata && !typeFromConfig) {
      logger.warn('Skipping malformed subBlock: unrecognized metadata entry', {
        blockId: block.id,
        subBlockId,
      })
      changed = true
      continue
    }

    const type =
      typeof subBlock.type === 'string' && subBlock.type.length > 0 && subBlock.type !== 'unknown'
        ? subBlock.type
        : typeFromConfig || DEFAULT_SUBBLOCK_TYPE
    const hasValue = Object.hasOwn(subBlock, 'value')
    const value =
      options.convertEmptyStringToNull && subBlock.value === ''
        ? null
        : hasValue
          ? subBlock.value
          : null

    const repairedMetadata = id !== subBlock.id || type !== subBlock.type
    const normalizedValue = hasValue && value !== subBlock.value

    if (repairedMetadata) {
      logger.warn('Repairing malformed subBlock metadata', { blockId: block.id, subBlockId })
      changed = true
    } else if (normalizedValue) {
      logger.warn('Normalizing malformed subBlock value', { blockId: block.id, subBlockId })
      changed = true
    }

    result[subBlockId] = { ...subBlock, id, type, value } as BlockState['subBlocks'][string]
  }

  return { subBlocks: changed ? result : (block.subBlocks as BlockState['subBlocks']), changed }
}
