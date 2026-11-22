import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { isNonEmptyValue } from '@sim/workflow-code/catalog/canonical-index'
import type { BlockState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { checkBlockPlacement } from '@/lib/workflows/editing/gates'
import { rewriteBlockNameReferences } from '@/lib/workflows/references/block-rename'
import { isValidKey } from '@/lib/workflows/sanitization/key-validation'
import { getTransitiveSubBlockDependents } from '@/lib/workflows/subblocks/dependencies'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import {
  applyBlockRetry,
  applyEditedBranchRows,
  applyTriggerConfigToBlockSubblocks,
  createBlockFromParams,
  createSubBlockInputGate,
  gateToolInputValue,
  normalizeResponseFormat,
  normalizeSubblockValue,
  updateCanonicalModesForInputs,
} from './builders'
import { VALID_LOOP_TYPES, VALID_PARALLEL_TYPES } from './container-types'
import type { EditWorkflowOperation, OperationContext, ValidationError } from './types'
import { logSkippedItem } from './types'
import { findBlockWithDuplicateNormalizedName, validateInputsForBlock } from './validation'

const logger = createLogger('EditWorkflowServerTool')

/** The graph's blocks other than `blockId`, for judging that block's own type change. */
function otherBlocks(
  blocks: Record<string, { type: string }>,
  blockId: string
): Array<{ type: string }> {
  return Object.entries(blocks)
    .filter(([id]) => id !== blockId)
    .map(([, block]) => block)
}

/**
 * Holds a new child of a container to the same placement gates as a top-level `add`.
 *
 * @returns whether the placement was refused
 */
function refuseNestedPlacement(
  parentBlockId: string,
  childId: string,
  childBlock: { type?: unknown },
  ctx: OperationContext
): boolean {
  const refusal = checkBlockPlacement(
    {
      blockId: childId,
      blockType: typeof childBlock.type === 'string' ? childBlock.type : '',
      operationType: 'add_nested_node',
      outcome: 'child block skipped',
      details: { parentBlockId },
      others: ctx.modifiedState.blocks,
    },
    { permissionConfig: ctx.permissionConfig }
  )
  if (!refusal) return false
  logSkippedItem(ctx.skippedItems, refusal)
  return true
}

/** The fields of a loop's or parallel's `data` that hold block references the runtime resolves. */
const CONTAINER_REFERENCE_FIELDS = ['collection', 'whileCondition', 'doWhileCondition'] as const

/**
 * Renames a block and rewrites the `<name.` references every other block holds to it: in its
 * sub-blocks, the same rewrite the editor's rename applies, and in a loop's or parallel's
 * collection and conditions, which the loop and parallel records are rebuilt from.
 */
function renameBlock(blocks: Record<string, BlockState>, blockId: string, name: string): void {
  const nameMap = new Map([[normalizeName(blocks[blockId].name), normalizeName(name)]])
  blocks[blockId].name = name
  for (const [id, block] of Object.entries(blocks)) {
    if (id === blockId) continue
    for (const subBlock of Object.values(block.subBlocks ?? {})) {
      if (subBlock.value === undefined || subBlock.value === null) continue
      subBlock.value = rewriteBlockNameReferences(subBlock.value, nameMap)
    }
    const data = block.data
    if (!data || (block.type !== 'loop' && block.type !== 'parallel')) continue
    for (const field of CONTAINER_REFERENCE_FIELDS) {
      const value = data[field]
      if (typeof value === 'string') data[field] = rewriteBlockNameReferences(value, nameMap)
    }
  }
}

/**
 * A loop's `iterations` or a parallel's `count` as stored: a whole number of at least 1, given as
 * a number or as a string of digits (the way a number input coerces), the bound source compile
 * holds a count to. Anything else (`0`, `-1`, `2.5`, `"1e3"`, `"0x10"`) is refused as an input
 * validation error, keeping `current`, since the loader would otherwise reset it to its default.
 */
function containerCount(
  block: BlockState,
  field: 'iterations' | 'count',
  value: unknown,
  validationErrors: ValidationError[],
  current?: unknown
): unknown {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : Number.NaN
  if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed
  validationErrors.push({
    blockId: block.id,
    blockType: block.type,
    field,
    value,
    error: `Invalid ${field} "${String(value)}" for ${block.type} "${block.name}" - must be a whole number of at least 1`,
  })
  return current
}

/**
 * Applies loop/parallel container config from `inputs` onto a block state (data.loopType, etc.).
 */
function applyLoopOrParallelContainerData(
  block: any,
  params: Record<string, any>,
  validationErrors: ValidationError[]
): void {
  if (params.type === 'loop') {
    const loopType =
      params.inputs?.loopType && VALID_LOOP_TYPES.includes(params.inputs.loopType)
        ? params.inputs.loopType
        : 'for'
    block.data = {
      ...block.data,
      loopType,
      ...(loopType === 'forEach' &&
        params.inputs?.collection && { collection: params.inputs.collection }),
      ...(loopType === 'for' &&
        params.inputs?.iterations !== undefined && {
          count: containerCount(
            block,
            'iterations',
            params.inputs.iterations,
            validationErrors,
            block.data?.count
          ),
        }),
      ...(loopType === 'while' &&
        params.inputs?.condition && { whileCondition: params.inputs.condition }),
      ...(loopType === 'doWhile' &&
        params.inputs?.condition && { doWhileCondition: params.inputs.condition }),
    }
  } else if (params.type === 'parallel') {
    const parallelType =
      params.inputs?.parallelType && VALID_PARALLEL_TYPES.includes(params.inputs.parallelType)
        ? params.inputs.parallelType
        : 'count'
    block.data = {
      ...block.data,
      parallelType,
      ...(parallelType === 'collection' &&
        params.inputs?.collection && { collection: params.inputs.collection }),
      ...(parallelType === 'count' &&
        params.inputs?.count !== undefined && {
          count: containerCount(
            block,
            'count',
            params.inputs.count,
            validationErrors,
            block.data?.count
          ),
        }),
    }
  }
}

/**
 * Adds child blocks under a loop/parallel container, including nested loop/parallel subflows.
 */
function processNestedNodesForParent(
  parentBlockId: string,
  nestedNodes: Record<string, any>,
  ctx: OperationContext
): void {
  const { modifiedState, skippedItems, validationErrors, permissionConfig, deferredConnections } =
    ctx

  const parentBlock = modifiedState.blocks[parentBlockId]
  if (parentBlock?.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'add_nested_nodes',
      blockId: parentBlockId,
      reason: `Container "${parentBlockId}" is locked - cannot add nested nodes`,
    })
    return
  }

  Object.entries(nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
    if (!isValidKey(childId)) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: 'add_nested_node',
        blockId: String(childId || 'invalid'),
        reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
      })
      logger.error('Invalid childId detected in nestedNodes', {
        parentBlockId,
        childId,
        childId_type: typeof childId,
      })
      return
    }

    if (refuseNestedPlacement(parentBlockId, childId, childBlock, ctx)) return

    const childBlockState = createBlockFromParams(
      childId,
      childBlock,
      parentBlockId,
      validationErrors,
      permissionConfig,
      skippedItems,
      ctx.enforceToolBindingContract
    )
    if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
      applyLoopOrParallelContainerData(childBlockState, childBlock, validationErrors)
    }
    modifiedState.blocks[childId] = childBlockState

    if (childBlock.connections) {
      deferredConnections.push({
        blockId: childId,
        connections: childBlock.connections,
      })
    }

    if (childBlock.nestedNodes && (childBlock.type === 'loop' || childBlock.type === 'parallel')) {
      processNestedNodesForParent(childId, childBlock.nestedNodes, ctx)
    }
  })
}

function updateLoopOrParallelContainerData(
  block: any,
  params: Record<string, any>,
  validationErrors: ValidationError[]
): void {
  if (block.type === 'loop') {
    block.data = block.data || {}
    if (params.inputs?.loopType) {
      const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
      if (validLoopTypes.includes(params.inputs.loopType)) {
        block.data.loopType = params.inputs.loopType
      }
    }
    const effectiveLoopType = params.inputs?.loopType ?? block.data.loopType ?? 'for'
    if (params.inputs?.iterations !== undefined && effectiveLoopType === 'for') {
      block.data.count = containerCount(
        block,
        'iterations',
        params.inputs.iterations,
        validationErrors,
        block.data.count
      )
    }
    if (params.inputs?.collection && effectiveLoopType === 'forEach') {
      block.data.collection = params.inputs.collection
    }
    if (
      params.inputs?.condition &&
      (effectiveLoopType === 'while' || effectiveLoopType === 'doWhile')
    ) {
      if (effectiveLoopType === 'doWhile') {
        block.data.doWhileCondition = params.inputs.condition
      } else {
        block.data.whileCondition = params.inputs.condition
      }
    }
  } else if (block.type === 'parallel') {
    block.data = block.data || {}
    if (params.inputs?.parallelType) {
      const validParallelTypes = ['count', 'collection']
      if (validParallelTypes.includes(params.inputs.parallelType)) {
        block.data.parallelType = params.inputs.parallelType
      }
    }
    const effectiveParallelType = params.inputs?.parallelType ?? block.data.parallelType ?? 'count'
    if (params.inputs?.count !== undefined && effectiveParallelType === 'count') {
      block.data.count = containerCount(
        block,
        'count',
        params.inputs.count,
        validationErrors,
        block.data.count
      )
    }
    if (params.inputs?.collection && effectiveParallelType === 'collection') {
      block.data.collection = params.inputs.collection
    }
  }
}

function mergeNestedNodesForParent(
  parentBlockId: string,
  nestedNodes: Record<string, any>,
  ctx: OperationContext
): void {
  const { modifiedState, skippedItems, validationErrors, permissionConfig, deferredConnections } =
    ctx

  const existingChildren: Array<[string, any]> = Object.entries(modifiedState.blocks).filter(
    ([, block]: [string, any]) => block.data?.parentId === parentBlockId
  )

  const existingByName = new Map<string, [string, any]>()
  for (const [id, child] of existingChildren) {
    existingByName.set(normalizeName(child.name), [id, child])
  }

  const matchedExistingIds = new Set<string>()

  Object.entries(nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
    const incomingName = normalizeName(childBlock.name || '')
    const existingMatch = incomingName ? existingByName.get(incomingName) : undefined

    if (existingMatch) {
      const [existingId, existingBlock] = existingMatch
      matchedExistingIds.add(existingId)

      if (childBlock.inputs) {
        if (!existingBlock.subBlocks) existingBlock.subBlocks = {}
        const childValidation = validateInputsForBlock(
          existingBlock.type,
          childBlock.inputs,
          existingId,
          buildSubBlockValues(existingBlock.subBlocks),
          ctx.enforceToolBindingContract,
          existingBlock.triggerMode === true
        )
        validationErrors.push(...childValidation.errors)

        const isInputAllowed = createSubBlockInputGate({
          blockType: existingBlock.type,
          permissionConfig,
          blockId: existingId,
          operationType: 'edit',
          skippedItems,
        })
        Object.entries(childValidation.validInputs).forEach(([key, value]) => {
          if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) return
          if (!isInputAllowed(key, value)) return
          let sanitizedValue = normalizeSubblockValue(key, value, existingBlock.type)
          sanitizedValue = applyEditedBranchRows(modifiedState, existingId, key, sanitizedValue)
          sanitizedValue = gateToolInputValue(
            { blockId: existingId, blockType: existingBlock.type, key, value, sanitizedValue },
            permissionConfig,
            skippedItems
          )
          if (key === 'responseFormat' && value) {
            sanitizedValue = normalizeResponseFormat(value)
          }

          const subBlockDef = getBlock(existingBlock.type)?.subBlocks.find(
            (sb: any) => sb.id === key
          )
          if (!existingBlock.subBlocks[key]) {
            existingBlock.subBlocks[key] = {
              id: key,
              type: subBlockDef?.type || 'short-input',
              value: sanitizedValue,
            }
          } else {
            existingBlock.subBlocks[key].value = sanitizedValue
          }
        })
      }

      if (existingBlock.type === 'loop' || existingBlock.type === 'parallel') {
        updateLoopOrParallelContainerData(existingBlock, childBlock, ctx.validationErrors)
      }

      if (childBlock.connections) {
        modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== existingId)
        deferredConnections.push({
          blockId: existingId,
          connections: childBlock.connections,
        })
      }

      if (
        childBlock.nestedNodes &&
        (existingBlock.type === 'loop' || existingBlock.type === 'parallel')
      ) {
        mergeNestedNodesForParent(existingId, childBlock.nestedNodes, ctx)
      }
      return
    }

    if (!isValidKey(childId)) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: 'add_nested_node',
        blockId: String(childId || 'invalid'),
        reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
      })
      return
    }

    if (refuseNestedPlacement(parentBlockId, childId, childBlock, ctx)) return

    const childBlockState = createBlockFromParams(
      childId,
      childBlock,
      parentBlockId,
      validationErrors,
      permissionConfig,
      skippedItems,
      ctx.enforceToolBindingContract
    )
    if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
      applyLoopOrParallelContainerData(childBlockState, childBlock, validationErrors)
    }
    modifiedState.blocks[childId] = childBlockState

    if (childBlock.connections) {
      deferredConnections.push({
        blockId: childId,
        connections: childBlock.connections,
      })
    }

    if (childBlock.nestedNodes && (childBlock.type === 'loop' || childBlock.type === 'parallel')) {
      processNestedNodesForParent(childId, childBlock.nestedNodes, ctx)
    }
  })

  const collectBlockAndDescendants = (
    rootId: string,
    collected = new Set<string>()
  ): Set<string> => {
    collected.add(rootId)
    Object.entries(modifiedState.blocks).forEach(([childId, block]: [string, any]) => {
      if (block.data?.parentId === rootId && !collected.has(childId)) {
        collectBlockAndDescendants(childId, collected)
      }
    })
    return collected
  }

  const removedIds = new Set<string>()
  for (const [existingId] of existingChildren) {
    if (!matchedExistingIds.has(existingId)) {
      const subtreeIds = collectBlockAndDescendants(existingId)
      subtreeIds.forEach((id) => {
        delete modifiedState.blocks[id]
        removedIds.add(id)
      })
    }
  }

  if (removedIds.size > 0) {
    modifiedState.edges = modifiedState.edges.filter(
      (edge: any) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
  }
}

export function handleDeleteOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems } = ctx
  const { block_id } = op

  if (!modifiedState.blocks[block_id]) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'delete',
      blockId: block_id,
      reason: `Block "${block_id}" does not exist and cannot be deleted`,
    })
    return
  }

  const deleteBlock = modifiedState.blocks[block_id]
  const deleteParentId = deleteBlock.data?.parentId as string | undefined
  const deleteParentLocked = deleteParentId ? modifiedState.blocks[deleteParentId]?.locked : false
  if (deleteBlock.locked || deleteParentLocked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'delete',
      blockId: block_id,
      reason: deleteParentLocked
        ? `Block "${block_id}" is inside locked container "${deleteParentId}" and cannot be deleted`
        : `Block "${block_id}" is locked and cannot be deleted`,
    })
    return
  }

  const blocksToRemove = new Set<string>([block_id])
  const findChildren = (parentId: string) => {
    Object.entries(modifiedState.blocks).forEach(([childId, child]: [string, any]) => {
      if (child.data?.parentId === parentId) {
        blocksToRemove.add(childId)
        findChildren(childId)
      }
    })
  }
  findChildren(block_id)

  blocksToRemove.forEach((id) => delete modifiedState.blocks[id])

  modifiedState.edges = modifiedState.edges.filter(
    (edge: any) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
  )
}

export function handleEditOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems, validationErrors, permissionConfig, deferredConnections } =
    ctx
  const { block_id, params } = op

  if (!modifiedState.blocks[block_id]) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'edit',
      blockId: block_id,
      reason: `Block "${block_id}" does not exist and cannot be edited`,
    })
    return
  }

  const block = modifiedState.blocks[block_id]

  const editParentId = block.data?.parentId as string | undefined
  const editParentLocked = editParentId ? modifiedState.blocks[editParentId]?.locked : false
  if (block.locked || editParentLocked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'edit',
      blockId: block_id,
      reason: editParentLocked
        ? `Block "${block_id}" is inside locked container "${editParentId}" and cannot be edited`
        : `Block "${block_id}" is locked and cannot be edited`,
    })
    return
  }

  if (!block.type) {
    logger.warn(`Block ${block_id} missing type property, skipping edit`, {
      blockKeys: Object.keys(block),
      blockData: JSON.stringify(block),
    })
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'edit',
      blockId: block_id,
      reason: `Block "${block_id}" exists but has no type property`,
    })
    return
  }

  // Before the inputs, so they are judged against the type the block will have.
  if (params?.type !== undefined) {
    const refusal = checkBlockPlacement(
      {
        blockId: block_id,
        blockType: params.type,
        previousType: block.type,
        operationType: 'edit',
        outcome: 'type change skipped',
        ...(params.type !== block.type && { others: otherBlocks(modifiedState.blocks, block_id) }),
      },
      { permissionConfig }
    )
    if (refusal) logSkippedItem(skippedItems, refusal)
    else block.type = params.type
  }

  if (params && Object.hasOwn(params, 'parentId')) {
    moveToParent(block, block_id, params.parentId, ctx)
  }

  if (params?.inputs) {
    if (!block.subBlocks) block.subBlocks = {}

    const previousSubBlockValues = new Map<string, unknown>(
      Object.entries(block.subBlocks).map(([key, subBlock]: [string, any]) => [
        key,
        structuredClone(subBlock?.value),
      ])
    )
    const explicitInputKeys = new Set<string>()

    const validationResult = validateInputsForBlock(
      block.type,
      params.inputs,
      block_id,
      buildSubBlockValues(block.subBlocks),
      ctx.enforceToolBindingContract,
      typeof params.triggerMode === 'boolean' ? params.triggerMode : block.triggerMode === true
    )
    validationErrors.push(...validationResult.errors)

    const isInputAllowed = createSubBlockInputGate({
      blockType: block.type,
      permissionConfig,
      blockId: block_id,
      operationType: 'edit',
      skippedItems,
    })

    Object.entries(validationResult.validInputs).forEach(([inputKey, value]) => {
      // Normalize common field name variations (LLM may use plural/singular inconsistently)
      let key = inputKey
      if (key === 'credentials' && !block.subBlocks.credentials && block.subBlocks.credential) {
        key = 'credential'
      }

      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }

      if (!isInputAllowed(key, value)) {
        return
      }

      explicitInputKeys.add(key)
      let sanitizedValue = normalizeSubblockValue(key, value, block.type)

      sanitizedValue = applyEditedBranchRows(modifiedState, block_id, key, sanitizedValue)

      sanitizedValue = gateToolInputValue(
        { blockId: block_id, blockType: block.type, key, value, sanitizedValue },
        permissionConfig,
        skippedItems
      )

      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      if (!block.subBlocks[key]) {
        const subBlockDef = getBlock(block.type)?.subBlocks.find((sb) => sb.id === key)
        block.subBlocks[key] = {
          id: key,
          type: subBlockDef?.type || 'short-input',
          value: sanitizedValue,
        }
      } else {
        const existingValue = block.subBlocks[key].value
        if (!isEqual(existingValue, sanitizedValue)) {
          block.subBlocks[key].value = sanitizedValue
        }
      }
    })

    if (
      Object.hasOwn(params.inputs, 'triggerConfig') &&
      block.subBlocks.triggerConfig &&
      isRecordLike(block.subBlocks.triggerConfig.value)
    ) {
      applyTriggerConfigToBlockSubblocks(block, block.subBlocks.triggerConfig.value, isInputAllowed)
      for (const key of Object.keys(block.subBlocks.triggerConfig.value)) {
        explicitInputKeys.add(key)
      }
    }

    if (block.type === 'loop') {
      block.data = block.data || {}
      if (params.inputs.loopType !== undefined) {
        const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
        if (validLoopTypes.includes(params.inputs.loopType)) {
          block.data.loopType = params.inputs.loopType
        }
      }
      const effectiveLoopType = params.inputs.loopType ?? block.data.loopType ?? 'for'
      if (params.inputs.iterations !== undefined && effectiveLoopType === 'for') {
        block.data.count = containerCount(
          block,
          'iterations',
          params.inputs.iterations,
          validationErrors,
          block.data.count
        )
      }
      if (params.inputs.collection !== undefined && effectiveLoopType === 'forEach') {
        block.data.collection = params.inputs.collection
      }
      if (
        params.inputs.condition !== undefined &&
        (effectiveLoopType === 'while' || effectiveLoopType === 'doWhile')
      ) {
        if (effectiveLoopType === 'doWhile') {
          block.data.doWhileCondition = params.inputs.condition
        } else {
          block.data.whileCondition = params.inputs.condition
        }
      }
    } else if (block.type === 'parallel') {
      block.data = block.data || {}
      if (params.inputs.parallelType !== undefined) {
        const validParallelTypes = ['count', 'collection']
        if (validParallelTypes.includes(params.inputs.parallelType)) {
          block.data.parallelType = params.inputs.parallelType
        }
      }
      const effectiveParallelType = params.inputs.parallelType ?? block.data.parallelType ?? 'count'
      if (params.inputs.count !== undefined && effectiveParallelType === 'count') {
        block.data.count = containerCount(
          block,
          'count',
          params.inputs.count,
          validationErrors,
          block.data.count
        )
      }
      if (params.inputs.collection !== undefined && effectiveParallelType === 'collection') {
        block.data.collection = params.inputs.collection
      }
    }

    const editBlockConfig = getBlock(block.type)
    if (editBlockConfig) {
      updateCanonicalModesForInputs(block, [...explicitInputKeys], editBlockConfig)

      const changedInputKeys = editBlockConfig.subBlocks
        .filter((subBlock) => {
          const currentSubBlock = block.subBlocks[subBlock.id]
          const existed = previousSubBlockValues.has(subBlock.id)
          if (!existed || !currentSubBlock) return existed !== Boolean(currentSubBlock)
          return !isEqual(previousSubBlockValues.get(subBlock.id), currentSubBlock.value)
        })
        .map((subBlock) => subBlock.id)

      for (const { subBlockId } of getTransitiveSubBlockDependents(
        editBlockConfig.subBlocks,
        changedInputKeys
      )) {
        if (explicitInputKeys.has(subBlockId)) continue
        const dependent = block.subBlocks[subBlockId]
        if (!dependent || !isNonEmptyValue(dependent.value)) continue
        dependent.value = ''
      }
    }
  }

  if (params?.name !== undefined) {
    const normalizedName = normalizeName(params.name)
    if (!normalizedName) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: 'edit',
        blockId: block_id,
        reason: `Cannot rename to empty name`,
        details: { requestedName: params.name },
      })
    } else if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(normalizedName)) {
      logSkippedItem(skippedItems, {
        type: 'reserved_block_name',
        operationType: 'edit',
        blockId: block_id,
        reason: `Cannot rename to "${params.name}" - this is a reserved name`,
        details: { requestedName: params.name },
      })
    } else {
      const conflictingBlock = findBlockWithDuplicateNormalizedName(
        modifiedState.blocks,
        params.name,
        block_id
      )

      if (conflictingBlock) {
        logSkippedItem(skippedItems, {
          type: 'duplicate_block_name',
          operationType: 'edit',
          blockId: block_id,
          reason: `Cannot rename to "${params.name}" - conflicts with "${conflictingBlock[1].name}"`,
          details: {
            requestedName: params.name,
            conflictingBlockId: conflictingBlock[0],
            conflictingBlockName: conflictingBlock[1].name,
          },
        })
      } else {
        renameBlock(modifiedState.blocks, block_id, params.name)
      }
    }
  }

  if (typeof params?.triggerMode === 'boolean') {
    block.triggerMode = params.triggerMode

    if (params.triggerMode === true) {
      modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.target !== block_id)
    }
  }

  if (typeof params?.advancedMode === 'boolean') {
    block.advancedMode = params.advancedMode
  }

  // Runs after the trigger-mode branch above so retry eligibility sees the
  // block's post-update mode: turning a block into a trigger in the same
  // operation makes it ineligible, exactly as the editor treats it.
  if (params?.retry !== undefined) {
    applyBlockRetry(
      block,
      params.retry,
      { operationType: 'edit', blockId: block_id, skippedItems },
      permissionConfig
    )
  }

  // Merge strategy: existing children that match an incoming node by name are updated in place
  // (preserving their block ID). New children are created. Children not present
  // in the incoming set are removed.
  if (params?.nestedNodes) {
    mergeNestedNodesForParent(block_id, params.nestedNodes, ctx)

    updateLoopOrParallelContainerData(block, params, ctx.validationErrors)
  }

  // Defer connections to pass 2 so all blocks exist before edges are created
  if (params?.connections) {
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

    // Re-specifying connections fully replaces this block's outgoing edges, so
    // drop any previously-recorded pending (forward-reference) connections too.
    if (block.data?.pendingConnections) {
      block.data.pendingConnections = undefined
    }

    deferredConnections.push({
      blockId: block_id,
      connections: params.connections,
    })
  }

  if (params?.removeEdges && Array.isArray(params.removeEdges)) {
    params.removeEdges.forEach(({ targetBlockId, sourceHandle = 'source' }) => {
      modifiedState.edges = modifiedState.edges.filter(
        (edge: any) =>
          !(
            edge.source === block_id &&
            edge.target === targetBlockId &&
            edge.sourceHandle === sourceHandle
          )
      )
    })
  }
}

/**
 * An edit's `params.parentId`: moves existing block `block` into the loop or parallel it names,
 * or with `null` (or an empty string) out of its container onto the canvas, keeping its id, as
 * `insert_into_subflow` and `extract_from_subflow` move one. A parentId that is no container is
 * declined with the reason.
 */
function moveToParent(
  block: BlockState,
  blockId: string,
  parentId: unknown,
  ctx: OperationContext
): void {
  const currentParent = block.data?.parentId
  if (parentId === null || parentId === '') {
    if (currentParent) placeAtTopLevel(block, currentParent, ctx.modifiedState.blocks)
    return
  }
  if (typeof parentId !== 'string') {
    logSkippedItem(ctx.skippedItems, {
      type: 'invalid_subflow_parent',
      operationType: 'edit',
      blockId,
      reason: `params.parentId of block "${blockId}" must be a loop or parallel id, or null to move it out of its container`,
      details: { parentId },
    })
    return
  }
  if (parentId === currentParent) return
  if (nestsInItself(blockId, parentId, 'edit', ctx)) return
  if (!subflowContainer(parentId, blockId, 'edit', ctx)) return
  placeInSubflow(block, parentId)
}

/**
 * Whether placing existing block `blockId` in container `parentId` would put it inside itself
 * (`parentId` is the block or sits anywhere inside it, a parent cycle), after recording why
 * `operationType` skips it.
 */
function nestsInItself(
  blockId: string,
  parentId: string,
  operationType: string,
  ctx: OperationContext
): boolean {
  if (!isSelfOrDescendant(parentId, blockId, ctx.modifiedState.blocks)) return false
  logSkippedItem(ctx.skippedItems, {
    type: 'invalid_subflow_parent',
    operationType,
    blockId,
    reason: `Cannot place block "${blockId}" in "${parentId}" - that would place the block inside itself`,
    details: { parentId },
  })
  return true
}

/**
 * Whether block `candidateId` is block `ancestorId` itself or sits anywhere inside it, following
 * the `parentId` chain up from `candidateId`. Making `ancestorId` a child of such a block would
 * create a parent cycle.
 */
function isSelfOrDescendant(
  candidateId: string,
  ancestorId: string,
  blocks: Record<string, BlockState>
): boolean {
  const seen = new Set<string>()
  let current: string | undefined = candidateId
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = blocks[current]?.data?.parentId
  }
  return false
}

export function handleAddOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems, validationErrors, permissionConfig, deferredConnections } =
    ctx
  const { block_id, params } = op

  const addNormalizedName = params?.name ? normalizeName(params.name) : ''
  if (!params?.type || !params?.name || !addNormalizedName) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'add',
      blockId: block_id,
      reason: `Missing required params (type or name) for adding block "${block_id}"`,
      details: { hasType: !!params?.type, hasName: !!params?.name },
    })
    return
  }

  if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(addNormalizedName)) {
    logSkippedItem(skippedItems, {
      type: 'reserved_block_name',
      operationType: 'add',
      blockId: block_id,
      reason: `Block name "${params.name}" is a reserved name and cannot be used`,
      details: { requestedName: params.name },
    })
    return
  }

  const conflictingBlock = findBlockWithDuplicateNormalizedName(
    modifiedState.blocks,
    params.name,
    block_id
  )

  if (conflictingBlock) {
    logSkippedItem(skippedItems, {
      type: 'duplicate_block_name',
      operationType: 'add',
      blockId: block_id,
      reason: `Block name "${params.name}" conflicts with existing block "${conflictingBlock[1].name}"`,
      details: {
        requestedName: params.name,
        conflictingBlockId: conflictingBlock[0],
        conflictingBlockName: conflictingBlock[1].name,
      },
    })
    return
  }

  const refusal = checkBlockPlacement(
    {
      blockId: block_id,
      blockType: params.type,
      operationType: 'add',
      outcome: 'block not added',
      others: modifiedState.blocks,
    },
    { permissionConfig }
  )
  if (refusal) {
    logSkippedItem(skippedItems, refusal)
    return
  }

  const newBlock = createBlockFromParams(
    block_id,
    params,
    undefined,
    validationErrors,
    permissionConfig,
    skippedItems,
    ctx.enforceToolBindingContract
  )

  if (params.type === 'loop' || params.type === 'parallel') {
    applyLoopOrParallelContainerData(newBlock, params, ctx.validationErrors)
  }

  // Add parent block FIRST before adding children
  // This ensures children can reference valid parentId
  modifiedState.blocks[block_id] = newBlock

  if (params.nestedNodes) {
    processNestedNodesForParent(block_id, params.nestedNodes, ctx)
  }

  // Defer connection processing to ensure all blocks exist first (pass 2)
  if (params.connections) {
    deferredConnections.push({
      blockId: block_id,
      connections: params.connections,
    })
  }
}

export function handleInsertIntoSubflowOperation(
  op: EditWorkflowOperation,
  ctx: OperationContext
): void {
  const { modifiedState, skippedItems, validationErrors, permissionConfig, deferredConnections } =
    ctx
  const { block_id, params } = op

  const subflowId = params?.subflowId
  if (!subflowId || !params?.type || !params?.name) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Missing required params (subflowId, type, or name) for inserting block "${block_id}"`,
      details: {
        hasSubflowId: !!subflowId,
        hasType: !!params?.type,
        hasName: !!params?.name,
      },
    })
    return
  }

  if (!subflowContainer(subflowId, block_id, 'insert_into_subflow', ctx)) return

  const existingBlock = modifiedState.blocks[block_id]

  if (existingBlock) {
    if (existingBlock.locked) {
      logSkippedItem(skippedItems, {
        type: 'block_locked',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Block "${block_id}" is locked and cannot be moved into a subflow`,
      })
      return
    }
    if (nestsInItself(block_id, subflowId, 'insert_into_subflow', ctx)) return

    placeInSubflow(existingBlock, subflowId)

    if (params.inputs) {
      const validationResult = validateInputsForBlock(
        existingBlock.type,
        params.inputs,
        block_id,
        buildSubBlockValues(existingBlock.subBlocks ?? {}),
        ctx.enforceToolBindingContract,
        existingBlock.triggerMode === true
      )
      validationErrors.push(...validationResult.errors)

      const isInputAllowed = createSubBlockInputGate({
        blockType: existingBlock.type,
        permissionConfig,
        blockId: block_id,
        operationType: 'insert_into_subflow',
        skippedItems,
      })
      Object.entries(validationResult.validInputs).forEach(([key, value]) => {
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
          return
        }

        if (!isInputAllowed(key, value)) {
          return
        }

        let sanitizedValue = normalizeSubblockValue(key, value, existingBlock.type)

        sanitizedValue = applyEditedBranchRows(modifiedState, block_id, key, sanitizedValue)

        sanitizedValue = gateToolInputValue(
          { blockId: block_id, blockType: existingBlock.type, key, value, sanitizedValue },
          permissionConfig,
          skippedItems
        )

        if (key === 'responseFormat' && value) {
          sanitizedValue = normalizeResponseFormat(value)
        }

        if (!existingBlock.subBlocks[key]) {
          const subBlockDef = getBlock(existingBlock.type)?.subBlocks.find((sb) => sb.id === key)
          existingBlock.subBlocks[key] = {
            id: key,
            type: subBlockDef?.type || 'short-input',
            value: sanitizedValue,
          }
        } else {
          existingBlock.subBlocks[key].value = sanitizedValue
        }
      })

      const existingBlockConfig = getBlock(existingBlock.type)
      if (existingBlockConfig) {
        updateCanonicalModesForInputs(
          existingBlock,
          Object.keys(validationResult.validInputs),
          existingBlockConfig
        )
      }
    }
  } else {
    const refusal = checkBlockPlacement(
      {
        blockId: block_id,
        blockType: params.type,
        operationType: 'insert_into_subflow',
        outcome: 'block not inserted into subflow',
        details: { subflowId },
        others: modifiedState.blocks,
      },
      { permissionConfig }
    )
    if (refusal) {
      logSkippedItem(skippedItems, refusal)
      return
    }

    const newBlock = createBlockFromParams(
      block_id,
      params,
      subflowId,
      validationErrors,
      permissionConfig,
      skippedItems,
      ctx.enforceToolBindingContract
    )
    modifiedState.blocks[block_id] = newBlock
    if (params.type === 'loop' || params.type === 'parallel') {
      applyLoopOrParallelContainerData(newBlock, params, ctx.validationErrors)
    }
    if (params.nestedNodes && (params.type === 'loop' || params.type === 'parallel')) {
      processNestedNodesForParent(block_id, params.nestedNodes, ctx)
    }
  }

  // Defer connection processing to ensure all blocks exist first
  // This is particularly important when multiple blocks are being inserted
  // and they have connections to each other
  if (params.connections) {
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

    // Re-specifying connections fully replaces this block's outgoing edges, so
    // drop any previously-recorded pending (forward-reference) connections too.
    const connBlock = modifiedState.blocks[block_id]
    if (connBlock?.data?.pendingConnections) {
      connBlock.data.pendingConnections = undefined
    }

    deferredConnections.push({
      blockId: block_id,
      connections: params.connections,
    })
  }
}

export function handleExtractFromSubflowOperation(
  op: EditWorkflowOperation,
  ctx: OperationContext
): void {
  const { modifiedState, skippedItems } = ctx
  const { block_id, params } = op

  const subflowId = params?.subflowId
  if (!subflowId) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Missing subflowId for extracting block "${block_id}"`,
    })
    return
  }

  const block = modifiedState.blocks[block_id]
  if (!block) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Block "${block_id}" not found for extraction`,
    })
    return
  }

  if (block.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Block "${block_id}" is locked and cannot be extracted from subflow`,
    })
    return
  }

  const parentSubflow = modifiedState.blocks[subflowId]
  if (parentSubflow?.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Subflow "${subflowId}" is locked - cannot extract block "${block_id}"`,
      details: { subflowId },
    })
    return
  }

  if (block.data?.parentId !== subflowId) {
    logger.warn('Block is not a child of specified subflow', {
      block_id,
      actualParent: block.data?.parentId,
      specifiedParent: subflowId,
    })
  }

  placeAtTopLevel(block, subflowId, modifiedState.blocks)
}

/**
 * The loop or parallel container `subflowId` names, for `operationType` to place block `blockId`
 * in, or `null` after recording why it cannot: no such block, locked, or not a container.
 */
function subflowContainer(
  subflowId: string,
  blockId: string,
  operationType: string,
  ctx: OperationContext
): BlockState | null {
  const container: BlockState | undefined = ctx.modifiedState.blocks[subflowId]
  if (!container) {
    logSkippedItem(ctx.skippedItems, {
      type: 'invalid_subflow_parent',
      operationType,
      blockId,
      reason: `Subflow block "${subflowId}" not found - block "${blockId}" not placed in it`,
      details: { subflowId },
    })
    return null
  }
  if (container.locked) {
    logSkippedItem(ctx.skippedItems, {
      type: 'block_locked',
      operationType,
      blockId,
      reason: `Subflow "${subflowId}" is locked - cannot place block "${blockId}" in it`,
      details: { subflowId },
    })
    return null
  }
  if (container.type !== 'loop' && container.type !== 'parallel') {
    logSkippedItem(ctx.skippedItems, {
      type: 'invalid_subflow_parent',
      operationType,
      blockId,
      reason: `Cannot place block "${blockId}" in "${subflowId}" - the target is a "${container.type}" block, not a loop or parallel container`,
      details: { subflowId, subflowType: container.type },
    })
    return null
  }
  return container
}

/**
 * Makes `block` a child of container `subflowId`. Its position resets because React Flow reads a
 * child's coordinates relative to its container; the old absolute position would place it far
 * outside the container's bounds.
 */
function placeInSubflow(block: BlockState, subflowId: string): void {
  block.data = { ...block.data, parentId: subflowId, extent: 'parent' }
  block.position = { x: 0, y: 0 }
}

/**
 * Takes `block` out of container `containerId` onto the canvas, at the absolute position it showed
 * at (its own offset plus that of every enclosing container), so it needs no targeted layout (an
 * extracted block often loses its edges to siblings left in the container, and layout would stack
 * it at layer 0). Without every position it goes to (0,0), which marks it for targeted layout.
 */
function placeAtTopLevel(
  block: BlockState,
  containerId: string,
  blocks: Record<string, BlockState>
): void {
  let position = block.position ? { x: block.position.x ?? 0, y: block.position.y ?? 0 } : null
  const seen = new Set<string>()
  let current: string | undefined = containerId
  while (position && current && !seen.has(current)) {
    seen.add(current)
    const container: BlockState | undefined = blocks[current]
    position = container?.position
      ? { x: position.x + (container.position.x ?? 0), y: position.y + (container.position.y ?? 0) }
      : null
    current = container?.data?.parentId
  }
  block.position = position ?? { x: 0, y: 0 }
  if (block.data) {
    block.data.parentId = undefined
    block.data.extent = undefined
  }
}
