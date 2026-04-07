import { createLogger } from '@sim/logger'
import { isValidKey } from '@/lib/workflows/sanitization/key-validation'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks/registry'
import { normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import {
  applyTriggerConfigToBlockSubblocks,
  createBlockFromParams,
  filterDisallowedTools,
  JSON_STRING_SUBBLOCK_KEYS,
  normalizeArrayWithIds,
  normalizeConditionRouterIds,
  normalizeResponseFormat,
  normalizeTools,
  shouldNormalizeArrayIds,
  updateCanonicalModesForInputs,
} from './builders'
import type { EditWorkflowOperation, OperationContext } from './types'
import { logSkippedItem } from './types'
import {
  findBlockWithDuplicateNormalizedName,
  isBlockTypeAllowed,
  validateInputsForBlock,
} from './validation'

const logger = createLogger('EditWorkflowServerTool')

/**
 * Applies loop/parallel container config from `inputs` onto a block state (data.loopType, etc.).
 */
function applyLoopOrParallelContainerData(block: any, params: Record<string, any>): void {
  if (params.type === 'loop') {
    const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
    const loopType =
      params.inputs?.loopType && validLoopTypes.includes(params.inputs.loopType)
        ? params.inputs.loopType
        : 'for'
    block.data = {
      ...block.data,
      loopType,
      ...(loopType === 'forEach' &&
        params.inputs?.collection && { collection: params.inputs.collection }),
      ...(loopType === 'for' && params.inputs?.iterations && { count: params.inputs.iterations }),
      ...(loopType === 'while' &&
        params.inputs?.condition && { whileCondition: params.inputs.condition }),
      ...(loopType === 'doWhile' &&
        params.inputs?.condition && { doWhileCondition: params.inputs.condition }),
    }
  } else if (params.type === 'parallel') {
    const validParallelTypes = ['count', 'collection']
    const parallelType =
      params.inputs?.parallelType && validParallelTypes.includes(params.inputs.parallelType)
        ? params.inputs.parallelType
        : 'count'
    block.data = {
      ...block.data,
      parallelType,
      ...(parallelType === 'collection' &&
        params.inputs?.collection && { collection: params.inputs.collection }),
      ...(parallelType === 'count' && params.inputs?.count && { count: params.inputs.count }),
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

    const childBlockState = createBlockFromParams(
      childId,
      childBlock,
      parentBlockId,
      validationErrors,
      permissionConfig,
      skippedItems
    )
    if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
      applyLoopOrParallelContainerData(childBlockState, childBlock)
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

function updateLoopOrParallelContainerData(block: any, params: Record<string, any>): void {
  if (block.type === 'loop') {
    block.data = block.data || {}
    if (params.inputs?.loopType) {
      const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
      if (validLoopTypes.includes(params.inputs.loopType)) {
        block.data.loopType = params.inputs.loopType
      }
    }
    const effectiveLoopType = params.inputs?.loopType ?? block.data.loopType ?? 'for'
    if (params.inputs?.iterations && effectiveLoopType === 'for') {
      block.data.count = params.inputs.iterations
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
    if (params.inputs?.count && effectiveParallelType === 'count') {
      block.data.count = params.inputs.count
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
          existingId
        )
        validationErrors.push(...childValidation.errors)

        Object.entries(childValidation.validInputs).forEach(([key, value]) => {
          if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) return
          let sanitizedValue = value
          if (shouldNormalizeArrayIds(key)) {
            sanitizedValue = normalizeArrayWithIds(value)
          }
          sanitizedValue = normalizeConditionRouterIds(existingId, key, sanitizedValue)
          if (key === 'tools' && Array.isArray(value)) {
            sanitizedValue = filterDisallowedTools(
              normalizeTools(value),
              permissionConfig,
              existingId,
              skippedItems
            )
          }
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
        updateLoopOrParallelContainerData(existingBlock, childBlock)
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

    const childBlockState = createBlockFromParams(
      childId,
      childBlock,
      parentBlockId,
      validationErrors,
      permissionConfig,
      skippedItems
    )
    if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
      applyLoopOrParallelContainerData(childBlockState, childBlock)
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

  // Check if block is locked or inside a locked container
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

  // Find all child blocks to remove
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

  // Remove blocks
  blocksToRemove.forEach((id) => delete modifiedState.blocks[id])

  // Remove edges connected to deleted blocks
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

  // Check if block is locked or inside a locked container
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

  // Ensure block has essential properties
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

  // Update inputs (convert to subBlocks format)
  if (params?.inputs) {
    if (!block.subBlocks) block.subBlocks = {}

    // Validate inputs against block configuration
    const validationResult = validateInputsForBlock(block.type, params.inputs, block_id)
    validationErrors.push(...validationResult.errors)

    Object.entries(validationResult.validInputs).forEach(([inputKey, value]) => {
      // Normalize common field name variations (LLM may use plural/singular inconsistently)
      let key = inputKey
      if (key === 'credentials' && !block.subBlocks.credentials && block.subBlocks.credential) {
        key = 'credential'
      }

      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }
      let sanitizedValue = value

      // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
      if (shouldNormalizeArrayIds(key)) {
        sanitizedValue = normalizeArrayWithIds(value)
        if (JSON_STRING_SUBBLOCK_KEYS.has(key)) {
          sanitizedValue = JSON.stringify(sanitizedValue)
        }
      }

      sanitizedValue = normalizeConditionRouterIds(block_id, key, sanitizedValue)

      // Special handling for tools - normalize and filter disallowed
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = filterDisallowedTools(
          normalizeTools(value),
          permissionConfig,
          block_id,
          skippedItems
        )
      }

      // Special handling for responseFormat - normalize to ensure consistent format
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
        const valuesEqual =
          typeof existingValue === 'object' || typeof sanitizedValue === 'object'
            ? JSON.stringify(existingValue) === JSON.stringify(sanitizedValue)
            : existingValue === sanitizedValue

        if (!valuesEqual) {
          block.subBlocks[key].value = sanitizedValue
        }
      }
    })

    if (
      Object.hasOwn(params.inputs, 'triggerConfig') &&
      block.subBlocks.triggerConfig &&
      typeof block.subBlocks.triggerConfig.value === 'object'
    ) {
      applyTriggerConfigToBlockSubblocks(block, block.subBlocks.triggerConfig.value)
    }

    // Update loop/parallel configuration in block.data (strict validation)
    if (block.type === 'loop') {
      block.data = block.data || {}
      // loopType is always valid
      if (params.inputs.loopType !== undefined) {
        const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
        if (validLoopTypes.includes(params.inputs.loopType)) {
          block.data.loopType = params.inputs.loopType
        }
      }
      const effectiveLoopType = params.inputs.loopType ?? block.data.loopType ?? 'for'
      // iterations only valid for 'for' loopType
      if (params.inputs.iterations !== undefined && effectiveLoopType === 'for') {
        block.data.count = params.inputs.iterations
      }
      // collection only valid for 'forEach' loopType
      if (params.inputs.collection !== undefined && effectiveLoopType === 'forEach') {
        block.data.collection = params.inputs.collection
      }
      // condition only valid for 'while' or 'doWhile' loopType
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
      // parallelType is always valid
      if (params.inputs.parallelType !== undefined) {
        const validParallelTypes = ['count', 'collection']
        if (validParallelTypes.includes(params.inputs.parallelType)) {
          block.data.parallelType = params.inputs.parallelType
        }
      }
      const effectiveParallelType = params.inputs.parallelType ?? block.data.parallelType ?? 'count'
      // count only valid for 'count' parallelType
      if (params.inputs.count !== undefined && effectiveParallelType === 'count') {
        block.data.count = params.inputs.count
      }
      // collection only valid for 'collection' parallelType
      if (params.inputs.collection !== undefined && effectiveParallelType === 'collection') {
        block.data.collection = params.inputs.collection
      }
    }

    const editBlockConfig = getBlock(block.type)
    if (editBlockConfig) {
      updateCanonicalModesForInputs(
        block,
        Object.keys(validationResult.validInputs),
        editBlockConfig
      )
    }
  }

  // Update basic properties
  if (params?.type !== undefined) {
    // Special container types (loop, parallel) are not in the block registry but are valid
    const isContainerType = params.type === 'loop' || params.type === 'parallel'

    // Validate type before setting (skip validation for container types)
    const blockConfig = getBlock(params.type)
    if (!blockConfig && !isContainerType) {
      logSkippedItem(skippedItems, {
        type: 'invalid_block_type',
        operationType: 'edit',
        blockId: block_id,
        reason: `Invalid block type "${params.type}" - type change skipped`,
        details: { requestedType: params.type },
      })
    } else if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
      logSkippedItem(skippedItems, {
        type: 'block_not_allowed',
        operationType: 'edit',
        blockId: block_id,
        reason: `Block type "${params.type}" is not allowed by permission group - type change skipped`,
        details: { requestedType: params.type },
      })
    } else {
      block.type = params.type
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
        block.name = params.name
      }
    }
  }

  // Handle trigger mode toggle
  if (typeof params?.triggerMode === 'boolean') {
    block.triggerMode = params.triggerMode

    if (params.triggerMode === true) {
      // Remove all incoming edges when enabling trigger mode
      modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.target !== block_id)
    }
  }

  // Handle advanced mode toggle
  if (typeof params?.advancedMode === 'boolean') {
    block.advancedMode = params.advancedMode
  }

  // Handle nested nodes update (for loops/parallels) using merge strategy.
  // Existing children that match an incoming node by name are updated in place
  // (preserving their block ID). New children are created. Children not present
  // in the incoming set are removed.
  if (params?.nestedNodes) {
    mergeNestedNodesForParent(block_id, params.nestedNodes, ctx)

    // Update loop/parallel configuration based on type (strict validation)
    updateLoopOrParallelContainerData(block, params)
  }

  // Defer connections to pass 2 so all blocks exist before edges are created
  if (params?.connections) {
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

    deferredConnections.push({
      blockId: block_id,
      connections: params.connections,
    })
  }

  // Handle edge removal
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

  // Special container types (loop, parallel) are not in the block registry but are valid
  const isContainerType = params.type === 'loop' || params.type === 'parallel'

  // Validate block type before adding (skip validation for container types)
  const addBlockConfig = getBlock(params.type)
  if (!addBlockConfig && !isContainerType) {
    logSkippedItem(skippedItems, {
      type: 'invalid_block_type',
      operationType: 'add',
      blockId: block_id,
      reason: `Invalid block type "${params.type}" - block not added`,
      details: { requestedType: params.type },
    })
    return
  }

  // Check if block type is allowed by permission group
  if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
    logSkippedItem(skippedItems, {
      type: 'block_not_allowed',
      operationType: 'add',
      blockId: block_id,
      reason: `Block type "${params.type}" is not allowed by permission group - block not added`,
      details: { requestedType: params.type },
    })
    return
  }

  const triggerIssue = TriggerUtils.getTriggerAdditionIssue(modifiedState.blocks, params.type)
  if (triggerIssue) {
    logSkippedItem(skippedItems, {
      type: 'duplicate_trigger',
      operationType: 'add',
      blockId: block_id,
      reason: `Cannot add ${triggerIssue.triggerName} - a workflow can only have one`,
      details: { requestedType: params.type, issue: triggerIssue.issue },
    })
    return
  }

  // Check single-instance block constraints (e.g., Response block)
  const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(
    modifiedState.blocks,
    params.type
  )
  if (singleInstanceIssue) {
    logSkippedItem(skippedItems, {
      type: 'duplicate_single_instance_block',
      operationType: 'add',
      blockId: block_id,
      reason: `Cannot add ${singleInstanceIssue.blockName} - a workflow can only have one`,
      details: { requestedType: params.type },
    })
    return
  }

  // Create new block with proper structure
  const newBlock = createBlockFromParams(
    block_id,
    params,
    undefined,
    validationErrors,
    permissionConfig,
    skippedItems
  )

  if (params.type === 'loop' || params.type === 'parallel') {
    applyLoopOrParallelContainerData(newBlock, params)
  }

  // Add parent block FIRST before adding children
  // This ensures children can reference valid parentId
  modifiedState.blocks[block_id] = newBlock

  // Handle nested nodes (for loops/parallels created from scratch)
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

  const subflowBlock = modifiedState.blocks[subflowId]
  if (!subflowBlock) {
    logSkippedItem(skippedItems, {
      type: 'invalid_subflow_parent',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Subflow block "${subflowId}" not found - block "${block_id}" not inserted`,
      details: { subflowId },
    })
    return
  }

  // Check if subflow is locked
  if (subflowBlock.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Subflow "${subflowId}" is locked - cannot insert block "${block_id}"`,
      details: { subflowId },
    })
    return
  }

  if (subflowBlock.type !== 'loop' && subflowBlock.type !== 'parallel') {
    logger.error('Subflow block has invalid type', {
      subflowId,
      type: subflowBlock.type,
      block_id,
    })
    return
  }

  // Check if block already exists (moving into subflow) or is new
  const existingBlock = modifiedState.blocks[block_id]

  if (existingBlock) {
    // Check if existing block is locked
    if (existingBlock.locked) {
      logSkippedItem(skippedItems, {
        type: 'block_locked',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Block "${block_id}" is locked and cannot be moved into a subflow`,
      })
      return
    }

    // Moving existing block into subflow — update parent and reset position.
    // Position must be reset because React Flow uses coordinates relative to
    // the parent container; keeping the old absolute position would place the
    // block far outside the container's bounds.
    existingBlock.data = {
      ...existingBlock.data,
      parentId: subflowId,
      extent: 'parent' as const,
    }
    existingBlock.position = { x: 0, y: 0 }

    // Update inputs if provided (with validation)
    if (params.inputs) {
      // Validate inputs against block configuration
      const validationResult = validateInputsForBlock(existingBlock.type, params.inputs, block_id)
      validationErrors.push(...validationResult.errors)

      Object.entries(validationResult.validInputs).forEach(([key, value]) => {
        // Skip runtime subblock IDs (webhookId, triggerPath)
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
          return
        }

        let sanitizedValue = value

        // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
        if (shouldNormalizeArrayIds(key)) {
          sanitizedValue = normalizeArrayWithIds(value)
          if (JSON_STRING_SUBBLOCK_KEYS.has(key)) {
            sanitizedValue = JSON.stringify(sanitizedValue)
          }
        }

        sanitizedValue = normalizeConditionRouterIds(block_id, key, sanitizedValue)

        // Special handling for tools - normalize and filter disallowed
        if (key === 'tools' && Array.isArray(value)) {
          sanitizedValue = filterDisallowedTools(
            normalizeTools(value),
            permissionConfig,
            block_id,
            skippedItems
          )
        }

        // Special handling for responseFormat - normalize to ensure consistent format
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
    // Special container types (loop, parallel) are not in the block registry but are valid
    const isContainerType = params.type === 'loop' || params.type === 'parallel'

    // Validate block type before creating (skip validation for container types)
    const insertBlockConfig = getBlock(params.type)
    if (!insertBlockConfig && !isContainerType) {
      logSkippedItem(skippedItems, {
        type: 'invalid_block_type',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Invalid block type "${params.type}" - block not inserted into subflow`,
        details: { requestedType: params.type, subflowId },
      })
      return
    }

    // Check if block type is allowed by permission group
    if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
      logSkippedItem(skippedItems, {
        type: 'block_not_allowed',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Block type "${params.type}" is not allowed by permission group - block not inserted`,
        details: { requestedType: params.type, subflowId },
      })
      return
    }

    // Create new block as child of subflow
    const newBlock = createBlockFromParams(
      block_id,
      params,
      subflowId,
      validationErrors,
      permissionConfig,
      skippedItems
    )
    modifiedState.blocks[block_id] = newBlock
    if (params.type === 'loop' || params.type === 'parallel') {
      applyLoopOrParallelContainerData(newBlock, params)
    }
    if (params.nestedNodes && (params.type === 'loop' || params.type === 'parallel')) {
      processNestedNodesForParent(block_id, params.nestedNodes, ctx)
    }
  }

  // Defer connection processing to ensure all blocks exist first
  // This is particularly important when multiple blocks are being inserted
  // and they have connections to each other
  if (params.connections) {
    // Remove existing edges from this block first
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

    // Add to deferred connections list
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

  // Check if block is locked
  if (block.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Block "${block_id}" is locked and cannot be extracted from subflow`,
    })
    return
  }

  // Check if parent subflow is locked
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

  // Verify it's actually a child of this subflow
  if (block.data?.parentId !== subflowId) {
    logger.warn('Block is not a child of specified subflow', {
      block_id,
      actualParent: block.data?.parentId,
      specifiedParent: subflowId,
    })
  }

  // Convert from relative (to container) to absolute position so the block
  // appears at roughly the same visual location after extraction. This avoids
  // needing targeted layout to reposition it — extracted blocks often lose
  // their edges to siblings still in the container, making them disconnected
  // and causing layout to stack them at layer 0.
  const container = modifiedState.blocks[subflowId]
  if (container?.position && block.position) {
    block.position = {
      x: (container.position.x ?? 0) + (block.position.x ?? 0),
      y: (container.position.y ?? 0) + (block.position.y ?? 0),
    }
  } else {
    // Fallback to (0,0) which signals to blocksNeedingLayout in index.ts
    // that this block requires targeted layout repositioning.
    block.position = { x: 0, y: 0 }
  }

  if (block.data) {
    block.data.parentId = undefined
    block.data.extent = undefined
  }
}
