import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { getBlock } from '@/blocks/registry'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import {
  getContextPack,
  getProposal,
  saveProposal,
  type WorkflowChangeProposal,
} from './change-store'
import { editWorkflowServerTool } from './edit-workflow'
import { applyOperationsToWorkflowState } from './edit-workflow/engine'
import { preValidateCredentialInputs } from './edit-workflow/validation'
import { hashWorkflowState, loadWorkflowStateFromDb } from './workflow-state'

const logger = createLogger('WorkflowChangeServerTool')

const TargetSchema = z
  .object({
    blockId: z.string().optional(),
    alias: z.string().optional(),
    match: z
      .object({
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
  })
  .strict()

const CredentialSelectionSchema = z
  .object({
    strategy: z.enum(['first_connected', 'by_id', 'by_name']).optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .strict()

const ChangeOperationSchema = z
  .object({
    op: z.enum(['set', 'unset', 'merge', 'append', 'remove', 'attach_credential']),
    path: z.string().optional(),
    value: z.any().optional(),
    provider: z.string().optional(),
    selection: CredentialSelectionSchema.optional(),
    required: z.boolean().optional(),
  })
  .strict()

const MutationSchema = z
  .object({
    action: z.enum([
      'ensure_block',
      'patch_block',
      'remove_block',
      'connect',
      'disconnect',
      'ensure_variable',
      'set_variable',
    ]),
    target: TargetSchema.optional(),
    type: z.string().optional(),
    name: z.string().optional(),
    inputs: z.record(z.any()).optional(),
    triggerMode: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    enabled: z.boolean().optional(),
    changes: z.array(ChangeOperationSchema).optional(),
    from: TargetSchema.optional(),
    to: TargetSchema.optional(),
    handle: z.string().optional(),
    toHandle: z.string().optional(),
    mode: z.enum(['set', 'append', 'remove']).optional(),
  })
  .strict()

const LinkEndpointSchema = z
  .object({
    blockId: z.string().optional(),
    alias: z.string().optional(),
    match: z
      .object({
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    handle: z.string().optional(),
  })
  .strict()

const LinkSchema = z
  .object({
    from: LinkEndpointSchema,
    to: LinkEndpointSchema,
    mode: z.enum(['set', 'append', 'remove']).optional(),
  })
  .strict()

const ChangeSpecSchema = z
  .object({
    objective: z.string().optional(),
    constraints: z.record(z.any()).optional(),
    resources: z.record(z.any()).optional(),
    mutations: z.array(MutationSchema).optional(),
    links: z.array(LinkSchema).optional(),
    acceptance: z.array(z.any()).optional(),
  })
  .strict()

const WorkflowChangeInputSchema = z
  .object({
    mode: z.enum(['dry_run', 'apply']),
    workflowId: z.string().optional(),
    contextPackId: z.string().optional(),
    proposalId: z.string().optional(),
    baseSnapshotHash: z.string().optional(),
    expectedSnapshotHash: z.string().optional(),
    changeSpec: ChangeSpecSchema.optional(),
  })
  .strict()

type WorkflowChangeParams = z.input<typeof WorkflowChangeInputSchema>
type ChangeSpec = z.input<typeof ChangeSpecSchema>
type TargetRef = z.input<typeof TargetSchema>
type ChangeOperation = z.input<typeof ChangeOperationSchema>

type CredentialRecord = {
  id: string
  name: string
  provider: string
  isDefault?: boolean
}

type ConnectionTarget = {
  block: string
  handle?: string
}

type ConnectionState = Map<string, Map<string, ConnectionTarget[]>>

function createDraftBlockId(seed?: string): string {
  const suffix = crypto.randomUUID().slice(0, 8)
  const base = seed ? seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) : 'draft'
  return `${base || 'draft'}_${suffix}`
}

function normalizeHandle(handle?: string): string {
  if (!handle) return 'source'
  if (handle === 'success') return 'source'
  return handle
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function buildConnectionState(workflowState: {
  edges: Array<Record<string, any>>
}): ConnectionState {
  const state: ConnectionState = new Map()
  for (const edge of workflowState.edges || []) {
    const source = String(edge.source || '')
    const target = String(edge.target || '')
    if (!source || !target) continue
    const sourceHandle = normalizeHandle(String(edge.sourceHandle || 'source'))
    const targetHandle = edge.targetHandle ? String(edge.targetHandle) : undefined

    let handleMap = state.get(source)
    if (!handleMap) {
      handleMap = new Map()
      state.set(source, handleMap)
    }
    const existing = handleMap.get(sourceHandle) || []
    existing.push({ block: target, handle: targetHandle })
    handleMap.set(sourceHandle, existing)
  }
  return state
}

function connectionStateToPayload(state: Map<string, ConnectionTarget[]>): Record<string, any> {
  const payload: Record<string, any> = {}
  for (const [handle, targets] of state.entries()) {
    if (!targets || targets.length === 0) continue
    const normalizedTargets = targets.map((target) => {
      if (!target.handle || target.handle === 'target') {
        return target.block
      }
      return { block: target.block, handle: target.handle }
    })
    payload[handle] = normalizedTargets.length === 1 ? normalizedTargets[0] : normalizedTargets
  }
  return payload
}

function findMatchingBlockId(
  workflowState: { blocks: Record<string, any> },
  target: TargetRef
): string | null {
  if (target.blockId && workflowState.blocks[target.blockId]) {
    return target.blockId
  }

  if (target.match) {
    const type = target.match.type
    const name = target.match.name?.toLowerCase()
    const matches = Object.entries(workflowState.blocks || {}).filter(([_, block]) => {
      const blockType = String((block as Record<string, unknown>).type || '')
      const blockName = String((block as Record<string, unknown>).name || '').toLowerCase()
      const typeOk = type ? blockType === type : true
      const nameOk = name ? blockName === name : true
      return typeOk && nameOk
    })
    if (matches.length === 1) {
      return matches[0][0]
    }
    if (matches.length > 1) {
      throw new Error(
        `ambiguous_target: target match resolved to ${matches.length} blocks (${matches.map(([id]) => id).join(', ')})`
      )
    }
  }

  return null
}

function getNestedValue(value: any, path: string[]): any {
  let cursor = value
  for (const segment of path) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function setNestedValue(base: any, path: string[], nextValue: any): any {
  if (path.length === 0) return nextValue
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) }
  let cursor: any = out
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    const current = cursor[key]
    cursor[key] =
      current && typeof current === 'object'
        ? Array.isArray(current)
          ? [...current]
          : { ...current }
        : {}
    cursor = cursor[key]
  }
  cursor[path[path.length - 1]] = nextValue
  return out
}

function removeArrayItem(arr: unknown[], value: unknown): unknown[] {
  return arr.filter((item) => JSON.stringify(item) !== JSON.stringify(value))
}

function selectCredentialId(
  availableCredentials: CredentialRecord[],
  provider: string,
  selection: z.infer<typeof CredentialSelectionSchema> | undefined
): string | null {
  const providerLower = provider.toLowerCase()
  const providerMatches = availableCredentials.filter((credential) => {
    const credentialProvider = credential.provider.toLowerCase()
    return (
      credentialProvider === providerLower || credentialProvider.startsWith(`${providerLower}-`)
    )
  })

  const pool = providerMatches.length > 0 ? providerMatches : availableCredentials
  const strategy = selection?.strategy || 'first_connected'

  if (strategy === 'by_id') {
    const id = selection?.id
    if (!id) return null
    return pool.find((credential) => credential.id === id)?.id || null
  }

  if (strategy === 'by_name') {
    const name = selection?.name?.toLowerCase()
    if (!name) return null
    const exact = pool.find((credential) => credential.name.toLowerCase() === name)
    if (exact) return exact.id
    const partial = pool.find((credential) => credential.name.toLowerCase().includes(name))
    return partial?.id || null
  }

  const defaultCredential = pool.find((credential) => credential.isDefault)
  if (defaultCredential) return defaultCredential.id
  return pool[0]?.id || null
}

function selectCredentialFieldId(blockType: string, provider: string): string | null {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return null

  const oauthFields = (blockConfig.subBlocks || []).filter(
    (subBlock) => subBlock.type === 'oauth-input'
  )
  if (oauthFields.length === 0) return null

  const providerKey = provider.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  const fieldMatch = oauthFields.find((subBlock) =>
    subBlock.id
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
      .includes(providerKey)
  )
  if (fieldMatch) return fieldMatch.id
  return oauthFields[0].id
}

function ensureConnectionTarget(
  existing: ConnectionTarget[],
  target: ConnectionTarget,
  mode: 'set' | 'append' | 'remove'
): ConnectionTarget[] {
  if (mode === 'set') {
    return [target]
  }

  if (mode === 'remove') {
    return existing.filter(
      (item) =>
        !(item.block === target.block && (item.handle || 'target') === (target.handle || 'target'))
    )
  }

  const duplicate = existing.some(
    (item) =>
      item.block === target.block && (item.handle || 'target') === (target.handle || 'target')
  )
  if (duplicate) return existing
  return [...existing, target]
}

async function compileChangeSpec(params: {
  changeSpec: ChangeSpec
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  userId: string
  workflowId: string
}): Promise<{
  operations: Array<Record<string, any>>
  warnings: string[]
  diagnostics: string[]
  touchedBlocks: string[]
}> {
  const { changeSpec, workflowState, userId, workflowId } = params
  const operations: Array<Record<string, any>> = []
  const diagnostics: string[] = []
  const warnings: string[] = []
  const touchedBlocks = new Set<string>()

  const aliasMap = new Map<string, string>()
  const workingState = deepClone(workflowState)
  const connectionState = buildConnectionState(workingState)
  const connectionTouchedSources = new Set<string>()
  const plannedBlockTypes = new Map<string, string>()

  // Seed aliases from existing block names.
  for (const [blockId, block] of Object.entries(workingState.blocks || {})) {
    const blockName = String((block as Record<string, unknown>).name || '')
    if (!blockName) continue
    const normalizedAlias = blockName.replace(/[^a-zA-Z0-9]/g, '')
    if (normalizedAlias && !aliasMap.has(normalizedAlias)) {
      aliasMap.set(normalizedAlias, blockId)
    }
  }

  const credentialsResponse = await getCredentialsServerTool.execute({ workflowId }, { userId })
  const availableCredentials: CredentialRecord[] =
    credentialsResponse?.oauth?.connected?.credentials?.map((credential: any) => ({
      id: String(credential.id || ''),
      name: String(credential.name || ''),
      provider: String(credential.provider || ''),
      isDefault: Boolean(credential.isDefault),
    })) || []

  const resolveTarget = (
    target: TargetRef | undefined,
    allowCreateAlias = false
  ): string | null => {
    if (!target) return null
    if (target.blockId) {
      if (workingState.blocks[target.blockId] || plannedBlockTypes.has(target.blockId)) {
        return target.blockId
      }
      return allowCreateAlias ? target.blockId : null
    }

    if (target.alias) {
      if (aliasMap.has(target.alias)) return aliasMap.get(target.alias) || null
      const byMatch = findMatchingBlockId(workingState, { alias: target.alias })
      if (byMatch) {
        aliasMap.set(target.alias, byMatch)
        return byMatch
      }
      return allowCreateAlias ? target.alias : null
    }

    const matched = findMatchingBlockId(workingState, target)
    if (matched) return matched
    return null
  }

  const applyPatchChange = (
    targetId: string,
    blockType: string | null,
    change: ChangeOperation,
    paramsOut: Record<string, any>
  ): void => {
    if (change.op === 'attach_credential') {
      const provider = change.provider
      if (!provider) {
        diagnostics.push(`attach_credential on ${targetId} is missing provider`)
        return
      }
      if (!blockType) {
        diagnostics.push(`attach_credential on ${targetId} failed: unknown block type`)
        return
      }
      const credentialFieldId = selectCredentialFieldId(blockType, provider)
      if (!credentialFieldId) {
        const msg = `No oauth input field found for block type "${blockType}" on ${targetId}`
        if (change.required) diagnostics.push(msg)
        else warnings.push(msg)
        return
      }

      const credentialId = selectCredentialId(availableCredentials, provider, change.selection)
      if (!credentialId) {
        const msg = `No credential found for provider "${provider}" on ${targetId}`
        if (change.required) diagnostics.push(msg)
        else warnings.push(msg)
        return
      }

      paramsOut.inputs = paramsOut.inputs || {}
      paramsOut.inputs[credentialFieldId] = credentialId
      return
    }

    if (!change.path) {
      diagnostics.push(`${change.op} on ${targetId} requires a path`)
      return
    }

    const pathSegments = change.path.split('.').filter(Boolean)
    if (pathSegments.length === 0) {
      diagnostics.push(`${change.op} on ${targetId} has an invalid path "${change.path}"`)
      return
    }

    if (pathSegments[0] === 'inputs') {
      const inputKey = pathSegments[1]
      if (!inputKey) {
        diagnostics.push(`${change.op} on ${targetId} has invalid input path "${change.path}"`)
        return
      }

      const currentInputValue =
        paramsOut.inputs?.[inputKey] ??
        workingState.blocks[targetId]?.subBlocks?.[inputKey]?.value ??
        null

      let nextInputValue = currentInputValue
      const nestedPath = pathSegments.slice(2)

      if (change.op === 'set') {
        nextInputValue =
          nestedPath.length > 0
            ? setNestedValue(currentInputValue ?? {}, nestedPath, change.value)
            : change.value
      } else if (change.op === 'unset') {
        nextInputValue =
          nestedPath.length > 0 ? setNestedValue(currentInputValue ?? {}, nestedPath, null) : null
      } else if (change.op === 'merge') {
        if (nestedPath.length > 0) {
          const baseObject = getNestedValue(currentInputValue ?? {}, nestedPath) || {}
          if (
            baseObject &&
            typeof baseObject === 'object' &&
            change.value &&
            typeof change.value === 'object'
          ) {
            nextInputValue = setNestedValue(currentInputValue ?? {}, nestedPath, {
              ...baseObject,
              ...(change.value as Record<string, unknown>),
            })
          } else {
            diagnostics.push(`merge on ${targetId} at "${change.path}" requires object values`)
            return
          }
        } else if (
          currentInputValue &&
          typeof currentInputValue === 'object' &&
          !Array.isArray(currentInputValue) &&
          change.value &&
          typeof change.value === 'object' &&
          !Array.isArray(change.value)
        ) {
          nextInputValue = { ...currentInputValue, ...(change.value as Record<string, unknown>) }
        } else if (currentInputValue == null && change.value && typeof change.value === 'object') {
          nextInputValue = change.value
        } else {
          diagnostics.push(`merge on ${targetId} at "${change.path}" requires object values`)
          return
        }
      } else if (change.op === 'append') {
        const arr = Array.isArray(currentInputValue) ? [...currentInputValue] : []
        arr.push(change.value)
        nextInputValue = arr
      } else if (change.op === 'remove') {
        if (!Array.isArray(currentInputValue)) {
          diagnostics.push(`remove on ${targetId} at "${change.path}" requires an array value`)
          return
        }
        nextInputValue = removeArrayItem(currentInputValue, change.value)
      }

      paramsOut.inputs = paramsOut.inputs || {}
      paramsOut.inputs[inputKey] = nextInputValue
      return
    }

    if (pathSegments.length !== 1) {
      diagnostics.push(
        `Unsupported path "${change.path}" on ${targetId}. Use inputs.* or top-level field names.`
      )
      return
    }
    const topLevelField = pathSegments[0]
    if (!['name', 'type', 'triggerMode', 'advancedMode', 'enabled'].includes(topLevelField)) {
      diagnostics.push(`Unsupported top-level path "${change.path}" on ${targetId}`)
      return
    }
    paramsOut[topLevelField] = change.op === 'unset' ? null : change.value
  }

  for (const mutation of changeSpec.mutations || []) {
    if (mutation.action === 'ensure_block') {
      const targetId = resolveTarget(mutation.target, true)
      if (!targetId) {
        diagnostics.push('ensure_block is missing a resolvable target')
        continue
      }

      const existingBlock = workingState.blocks[targetId]
      if (existingBlock) {
        const editParams: Record<string, any> = {}
        if (mutation.name) editParams.name = mutation.name
        if (mutation.type) editParams.type = mutation.type
        if (mutation.inputs) editParams.inputs = mutation.inputs
        if (mutation.triggerMode !== undefined) editParams.triggerMode = mutation.triggerMode
        if (mutation.advancedMode !== undefined) editParams.advancedMode = mutation.advancedMode
        if (mutation.enabled !== undefined) editParams.enabled = mutation.enabled
        operations.push({
          operation_type: 'edit',
          block_id: targetId,
          params: editParams,
        })
        touchedBlocks.add(targetId)
      } else {
        if (!mutation.type || !mutation.name) {
          diagnostics.push(`ensure_block for "${targetId}" requires type and name when creating`)
          continue
        }
        const blockId =
          mutation.target?.blockId || mutation.target?.alias || createDraftBlockId(mutation.name)
        const addParams: Record<string, any> = {
          type: mutation.type,
          name: mutation.name,
        }
        if (mutation.inputs) addParams.inputs = mutation.inputs
        if (mutation.triggerMode !== undefined) addParams.triggerMode = mutation.triggerMode
        if (mutation.advancedMode !== undefined) addParams.advancedMode = mutation.advancedMode
        if (mutation.enabled !== undefined) addParams.enabled = mutation.enabled
        operations.push({
          operation_type: 'add',
          block_id: blockId,
          params: addParams,
        })
        workingState.blocks[blockId] = {
          id: blockId,
          type: mutation.type,
          name: mutation.name,
          subBlocks: Object.fromEntries(
            Object.entries(mutation.inputs || {}).map(([key, value]) => [
              key,
              { id: key, value, type: 'short-input' },
            ])
          ),
          triggerMode: mutation.triggerMode || false,
          advancedMode: mutation.advancedMode || false,
          enabled: mutation.enabled !== undefined ? mutation.enabled : true,
        }
        plannedBlockTypes.set(blockId, mutation.type)
        touchedBlocks.add(blockId)
        if (mutation.target?.alias) aliasMap.set(mutation.target.alias, blockId)
      }
      continue
    }

    if (mutation.action === 'patch_block') {
      const targetId = resolveTarget(mutation.target)
      if (!targetId) {
        diagnostics.push('patch_block target could not be resolved')
        continue
      }
      const blockType =
        String(workingState.blocks[targetId]?.type || '') || plannedBlockTypes.get(targetId) || null

      const editParams: Record<string, any> = {}
      for (const change of mutation.changes || []) {
        applyPatchChange(targetId, blockType, change, editParams)
      }
      if (Object.keys(editParams).length === 0) {
        warnings.push(`patch_block for ${targetId} had no effective changes`)
        continue
      }
      operations.push({
        operation_type: 'edit',
        block_id: targetId,
        params: editParams,
      })
      touchedBlocks.add(targetId)
      continue
    }

    if (mutation.action === 'remove_block') {
      const targetId = resolveTarget(mutation.target)
      if (!targetId) {
        diagnostics.push('remove_block target could not be resolved')
        continue
      }
      operations.push({
        operation_type: 'delete',
        block_id: targetId,
        params: {},
      })
      touchedBlocks.add(targetId)
      connectionState.delete(targetId)
      for (const [source, handles] of connectionState.entries()) {
        for (const [handle, targets] of handles.entries()) {
          const nextTargets = targets.filter((target) => target.block !== targetId)
          handles.set(handle, nextTargets)
        }
        connectionTouchedSources.add(source)
      }
      continue
    }

    if (mutation.action === 'connect' || mutation.action === 'disconnect') {
      const from = resolveTarget(mutation.from)
      const to = resolveTarget(mutation.to)
      if (!from || !to) {
        diagnostics.push(`${mutation.action} requires resolvable from/to targets`)
        continue
      }
      const sourceHandle = normalizeHandle(mutation.handle)
      const targetHandle = mutation.toHandle || 'target'
      let sourceMap = connectionState.get(from)
      if (!sourceMap) {
        sourceMap = new Map()
        connectionState.set(from, sourceMap)
      }
      const existingTargets = sourceMap.get(sourceHandle) || []
      const mode = mutation.action === 'disconnect' ? 'remove' : mutation.mode || 'set'
      const nextTargets = ensureConnectionTarget(
        existingTargets,
        { block: to, handle: targetHandle },
        mode
      )
      sourceMap.set(sourceHandle, nextTargets)
      connectionTouchedSources.add(from)
      touchedBlocks.add(from)
    }
  }

  for (const link of changeSpec.links || []) {
    const from = resolveTarget(
      {
        blockId: link.from.blockId,
        alias: link.from.alias,
        match: link.from.match,
      },
      true
    )
    const to = resolveTarget(
      {
        blockId: link.to.blockId,
        alias: link.to.alias,
        match: link.to.match,
      },
      true
    )
    if (!from || !to) {
      diagnostics.push('link contains unresolved from/to target')
      continue
    }

    const sourceHandle = normalizeHandle(link.from.handle)
    const targetHandle = link.to.handle || 'target'
    let sourceMap = connectionState.get(from)
    if (!sourceMap) {
      sourceMap = new Map()
      connectionState.set(from, sourceMap)
    }
    const existingTargets = sourceMap.get(sourceHandle) || []
    const nextTargets = ensureConnectionTarget(
      existingTargets,
      { block: to, handle: targetHandle },
      link.mode || 'set'
    )
    sourceMap.set(sourceHandle, nextTargets)
    connectionTouchedSources.add(from)
    touchedBlocks.add(from)
  }

  for (const sourceBlockId of stableUnique([...connectionTouchedSources])) {
    if (!connectionState.has(sourceBlockId)) continue
    const sourceConnections = connectionState.get(sourceBlockId)!
    operations.push({
      operation_type: 'edit',
      block_id: sourceBlockId,
      params: {
        connections: connectionStateToPayload(sourceConnections),
      },
    })
  }

  return {
    operations,
    warnings,
    diagnostics,
    touchedBlocks: [...touchedBlocks],
  }
}

function summarizeDiff(
  beforeState: { blocks: Record<string, any>; edges: Array<Record<string, any>> },
  afterState: { blocks: Record<string, any>; edges: Array<Record<string, any>> },
  operations: Array<Record<string, any>>
): Record<string, any> {
  const beforeBlocks = Object.keys(beforeState.blocks || {}).length
  const afterBlocks = Object.keys(afterState.blocks || {}).length
  const beforeEdges = (beforeState.edges || []).length
  const afterEdges = (afterState.edges || []).length

  const counts = operations.reduce<Record<string, number>>((acc, operation) => {
    const opType = String(operation.operation_type || 'unknown')
    acc[opType] = (acc[opType] || 0) + 1
    return acc
  }, {})

  return {
    operationCounts: counts,
    blocks: {
      before: beforeBlocks,
      after: afterBlocks,
      delta: afterBlocks - beforeBlocks,
    },
    edges: {
      before: beforeEdges,
      after: afterEdges,
      delta: afterEdges - beforeEdges,
    },
  }
}

async function validateAndSimulateOperations(params: {
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  operations: Array<Record<string, any>>
  userId: string
}): Promise<{
  operationsForApply: Array<Record<string, any>>
  simulatedState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  warnings: string[]
  diagnostics: string[]
}> {
  const diagnostics: string[] = []
  const warnings: string[] = []

  const permissionConfig = await getUserPermissionConfig(params.userId)
  const { filteredOperations, errors: preValidationErrors } = await preValidateCredentialInputs(
    params.operations as any,
    { userId: params.userId },
    params.workflowState
  )
  for (const error of preValidationErrors) {
    warnings.push(error.error)
  }

  const { state, validationErrors, skippedItems } = applyOperationsToWorkflowState(
    params.workflowState,
    filteredOperations as any,
    permissionConfig
  )

  for (const validationError of validationErrors) {
    warnings.push(validationError.error)
  }
  for (const skippedItem of skippedItems) {
    warnings.push(skippedItem.reason)
  }

  if (Object.keys(state.blocks || {}).length === 0) {
    diagnostics.push('Simulation produced an empty workflow state')
  }

  return {
    operationsForApply: filteredOperations as Array<Record<string, any>>,
    simulatedState: state,
    warnings,
    diagnostics,
  }
}

export const workflowChangeServerTool: BaseServerTool<WorkflowChangeParams, any> = {
  name: 'workflow_change',
  inputSchema: WorkflowChangeInputSchema,
  async execute(params: WorkflowChangeParams, context?: { userId: string }): Promise<any> {
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    if (params.mode === 'dry_run') {
      const workflowId = params.workflowId || getContextPack(params.contextPackId || '')?.workflowId
      if (!workflowId) {
        throw new Error('workflowId is required for dry_run')
      }
      if (!params.changeSpec) {
        throw new Error('changeSpec is required for dry_run')
      }

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: context.userId,
        action: 'write',
      })
      if (!authorization.allowed) {
        throw new Error(authorization.message || 'Unauthorized workflow access')
      }

      const { workflowState } = await loadWorkflowStateFromDb(workflowId)
      const currentHash = hashWorkflowState(workflowState as unknown as Record<string, unknown>)
      const requestedHash = params.baseSnapshotHash
      if (requestedHash && requestedHash !== currentHash) {
        throw new Error(
          `snapshot_mismatch: expected ${requestedHash} but current state is ${currentHash}`
        )
      }

      const compileResult = await compileChangeSpec({
        changeSpec: params.changeSpec,
        workflowState,
        userId: context.userId,
        workflowId,
      })

      const simulation = await validateAndSimulateOperations({
        workflowState,
        operations: compileResult.operations,
        userId: context.userId,
      })

      const diffSummary = summarizeDiff(
        workflowState,
        simulation.simulatedState,
        simulation.operationsForApply
      )
      const diagnostics = [...compileResult.diagnostics, ...simulation.diagnostics]
      const warnings = [...compileResult.warnings, ...simulation.warnings]

      const proposal: WorkflowChangeProposal = {
        workflowId,
        baseSnapshotHash: currentHash,
        compiledOperations: simulation.operationsForApply,
        diffSummary,
        warnings,
        diagnostics,
        touchedBlocks: compileResult.touchedBlocks,
      }
      const proposalId = saveProposal(proposal)

      logger.info('Compiled workflow_change dry run', {
        workflowId,
        proposalId,
        operationCount: proposal.compiledOperations.length,
        warningCount: warnings.length,
        diagnosticsCount: diagnostics.length,
      })

      return {
        success: diagnostics.length === 0,
        mode: 'dry_run',
        workflowId,
        proposalId,
        baseSnapshotHash: currentHash,
        compiledOperations: proposal.compiledOperations,
        diffSummary,
        warnings,
        diagnostics,
        touchedBlocks: proposal.touchedBlocks,
      }
    }

    // apply mode
    const proposalId = params.proposalId
    if (!proposalId) {
      throw new Error('proposalId is required for apply')
    }

    const proposal = getProposal(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found or expired: ${proposalId}`)
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: proposal.workflowId,
      userId: context.userId,
      action: 'write',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    const { workflowState } = await loadWorkflowStateFromDb(proposal.workflowId)
    const currentHash = hashWorkflowState(workflowState as unknown as Record<string, unknown>)
    const expectedHash = params.expectedSnapshotHash || proposal.baseSnapshotHash
    if (expectedHash && expectedHash !== currentHash) {
      throw new Error(`snapshot_mismatch: expected ${expectedHash} but current is ${currentHash}`)
    }

    const applyResult = await editWorkflowServerTool.execute(
      {
        workflowId: proposal.workflowId,
        operations: proposal.compiledOperations as any,
      },
      { userId: context.userId }
    )

    const appliedWorkflowState = (applyResult as any)?.workflowState
    const newSnapshotHash = appliedWorkflowState
      ? hashWorkflowState(appliedWorkflowState as Record<string, unknown>)
      : null

    return {
      success: true,
      mode: 'apply',
      workflowId: proposal.workflowId,
      proposalId,
      baseSnapshotHash: proposal.baseSnapshotHash,
      newSnapshotHash,
      operations: proposal.compiledOperations,
      workflowState: appliedWorkflowState || null,
      appliedDiff: proposal.diffSummary,
      warnings: proposal.warnings,
      diagnostics: proposal.diagnostics,
      editResult: applyResult,
    }
  },
}
