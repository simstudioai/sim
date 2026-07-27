import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_SUBBLOCK_TYPE } from '@sim/workflow-persistence/subblocks'
import { getBlock } from '@/blocks'
import { isCustomBlockType } from '@/blocks/custom/build-config'
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
 *
 * For keys the block registry declares, the CONFIGURED type is authoritative
 * and overwrites a contradicting stored type. Stored types drift in two ways:
 * fallback writers stamp a plausible-but-wrong default (`short-input`) when
 * they synthesize a missing structure entry, and block configs evolve their
 * declared types over time while persisted rows keep the old one. A wrong
 * stored type silently disables type-gated logic downstream — most damaging
 * for `condition-input`/`router-input`, where copy-time id remapping skips
 * the conditions array while edge handles still remap, orphaning the edges.
 * Draft loads persist this repair via `persistMigratedBlocks`, so stored
 * state converges back to the registry.
 *
 * Custom blocks are schema-agnostic here: their server-side config never
 * declares the per-field input sub-blocks (the execution overlay passes bare
 * wiring rows, and this may run with no overlay at all), so "not in config"
 * carries no signal for them. A consumer-typed field value stored via the
 * realtime `type: 'unknown'` fallback must be repaired to a concrete type and
 * kept — dropping it would delete user input from the draft. Values for fields
 * the source workflow no longer has are filtered at serialization/execution
 * (`customBlockHasDeclaredInputs`, `remapCustomBlockInputKeys`), never at rest.
 */
export function sanitizeMalformedSubBlocks(
  block: SanitizableBlock,
  options: SanitizeMalformedSubBlocksOptions = {}
): { subBlocks: Record<string, BlockState['subBlocks'][string]>; changed: boolean } {
  let changed = false
  const blockConfig = getBlock(block.type)
  const schemaAgnostic = isCustomBlockType(block.type)
  const result: Record<string, BlockState['subBlocks'][string]> = {}

  for (const [subBlockId, subBlock] of Object.entries(block.subBlocks || {})) {
    if (subBlockId === 'undefined') {
      logger.warn('Skipping malformed subBlock with key "undefined"', { blockId: block.id })
      changed = true
      continue
    }

    const configuredType = blockConfig?.subBlocks?.find((config) => config.id === subBlockId)?.type

    if (!isPlainRecord(subBlock)) {
      if (!configuredType && !schemaAgnostic) {
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

    if (subBlock.type === 'unknown' && !configuredType && !schemaAgnostic) {
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

    if (missingMetadata && !typeFromConfig && !schemaAgnostic) {
      logger.warn('Skipping malformed subBlock: unrecognized metadata entry', {
        blockId: block.id,
        subBlockId,
      })
      changed = true
      continue
    }

    const storedType =
      typeof subBlock.type === 'string' && subBlock.type.length > 0 && subBlock.type !== 'unknown'
        ? subBlock.type
        : null
    const type = typeFromConfig ?? storedType ?? DEFAULT_SUBBLOCK_TYPE
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
      logger.warn('Repairing malformed subBlock metadata', {
        blockId: block.id,
        subBlockId,
        storedType: subBlock.type,
        repairedType: type,
      })
      changed = true
    } else if (normalizedValue) {
      logger.warn('Normalizing malformed subBlock value', { blockId: block.id, subBlockId })
      changed = true
    }

    result[subBlockId] = { ...subBlock, id, type, value } as BlockState['subBlocks'][string]
  }

  return { subBlocks: changed ? result : (block.subBlocks as BlockState['subBlocks']), changed }
}
