import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import {
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
} from '@/lib/copilot/orchestrator/tool-executor/workflow-tools'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { getBlock } from '@/blocks/registry'
import { getTool } from '@/tools/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import { getBlockSchema } from '@/executor/utils/block-data'
import { InvalidFieldError, type OutputSchema, resolveBlockReference } from '@/executor/utils/block-reference'
import { replaceValidReferences } from '@/executor/utils/reference-validation'
import {
  getContextPack,
  getProposal,
  saveProposal,
  type WorkflowChangeProposal,
} from './change-store'
import { applyWorkflowOperations } from './workflow-operations/apply'
import { applyOperationsToWorkflowState } from './workflow-operations/engine'
import { preValidateCredentialInputs, validateInputsForBlock } from './workflow-operations/validation'
import { workflowVerifyServerTool } from './workflow-verify'
import { hashWorkflowState, loadWorkflowStateFromDb } from './workflow-state'
import type { SerializedBlock } from '@/serializer/types'

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
  .refine((target) => Boolean(target.blockId || target.alias || target.match), {
    message: 'target must include blockId, alias, or match',
  })

const CredentialSelectionSchema = z
  .object({
    strategy: z.enum(['first_connected', 'by_id', 'by_name']).optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .strict()

const ToolCredentialTargetSchema = z
  .object({
    index: z.number().int().min(0).optional(),
    toolId: z.string().optional(),
    type: z.string().optional(),
    title: z.string().optional(),
    operation: z.string().optional(),
  })
  .strict()
  .refine(
    (toolTarget) =>
      toolTarget.index !== undefined ||
      Boolean(
        toolTarget.toolId || toolTarget.type || toolTarget.title || toolTarget.operation
      ),
    {
      message: 'tool selector must include at least one of index/toolId/type/title/operation',
    }
  )

const ChangeOperationSchema = z
  .object({
    op: z.enum(['set', 'unset', 'merge', 'append', 'remove', 'attach_credential']),
    path: z.string().optional(),
    value: z.any().optional(),
    provider: z.string().optional(),
    selection: CredentialSelectionSchema.optional(),
    tool: ToolCredentialTargetSchema.optional(),
    credentialPath: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict()

const EnsureBlockMutationSchema = z
  .object({
    action: z.literal('ensure_block'),
    target: TargetSchema,
    type: z.string().optional(),
    name: z.string().optional(),
    inputs: z.record(z.any()).optional(),
    triggerMode: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const PatchBlockMutationSchema = z
  .object({
    action: z.literal('patch_block'),
    target: TargetSchema,
    changes: z.array(ChangeOperationSchema).min(1),
  })
  .strict()

const RemoveBlockMutationSchema = z
  .object({
    action: z.literal('remove_block'),
    target: TargetSchema,
  })
  .strict()

const InsertIntoSubflowMutationSchema = z
  .object({
    action: z.literal('insert_into_subflow'),
    target: TargetSchema.optional(),
    subflow: TargetSchema,
    type: z.string().optional(),
    name: z.string().optional(),
    inputs: z.record(z.any()).optional(),
    triggerMode: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const ExtractFromSubflowMutationSchema = z
  .object({
    action: z.literal('extract_from_subflow'),
    target: TargetSchema,
    subflow: TargetSchema.optional(),
  })
  .strict()

const ConnectMutationSchema = z
  .object({
    action: z.literal('connect'),
    from: TargetSchema,
    to: TargetSchema,
    handle: z.string().optional(),
    toHandle: z.string().optional(),
    mode: z.enum(['set', 'append', 'remove']).optional(),
  })
  .strict()

const DisconnectMutationSchema = z
  .object({
    action: z.literal('disconnect'),
    from: TargetSchema,
    to: TargetSchema,
    handle: z.string().optional(),
    toHandle: z.string().optional(),
  })
  .strict()

const MutationSchema = z.discriminatedUnion('action', [
  EnsureBlockMutationSchema,
  PatchBlockMutationSchema,
  RemoveBlockMutationSchema,
  InsertIntoSubflowMutationSchema,
  ExtractFromSubflowMutationSchema,
  ConnectMutationSchema,
  DisconnectMutationSchema,
])

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

const PostApplyRunSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['full', 'until_block', 'from_block', 'block']).optional(),
    useDeployedState: z.boolean().optional(),
    workflowInput: z.record(z.any()).optional(),
    stopAfterBlockId: z.string().optional(),
    startBlockId: z.string().optional(),
    blockId: z.string().optional(),
  })
  .strict()

const PostApplyEvaluatorSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireVerified: z.boolean().optional(),
    maxWarnings: z.number().int().min(0).optional(),
    maxDiagnostics: z.number().int().min(0).optional(),
    requireRunSuccess: z.boolean().optional(),
  })
  .strict()

const PostApplySchema = z
  .object({
    verify: z.boolean().optional(),
    run: PostApplyRunSchema.optional(),
    evaluator: PostApplyEvaluatorSchema.optional(),
  })
  .strict()

const AcceptanceItemSchema = z.union([
  z.string(),
  z
    .object({
      kind: z.string().optional(),
      assert: z.string(),
    })
    .strict(),
])

const ChangeSpecSchema = z
  .object({
    version: z.literal('1').optional(),
    objective: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    assumptions: z.array(z.string()).optional(),
    unresolvedRisks: z.array(z.string()).optional(),
    resolvedIds: z.record(z.string()).optional(),
    resources: z.record(z.any()).optional(),
    mutations: z.array(MutationSchema).optional(),
    links: z.array(LinkSchema).optional(),
    acceptance: z.array(AcceptanceItemSchema).optional(),
    postApply: PostApplySchema.optional(),
  })
  .strict()
  .refine((spec) => Boolean((spec.mutations && spec.mutations.length > 0) || (spec.links && spec.links.length > 0)), {
    message: 'changeSpec must include at least one mutation or link',
  })

const WorkflowChangeInputSchema = z
  .object({
    mode: z.enum(['dry_run', 'apply']),
    workflowId: z.string().optional(),
    contextPackId: z.string().optional(),
    proposalId: z.string().optional(),
    baseSnapshotHash: z.string().optional(),
    expectedSnapshotHash: z.string().optional(),
    changeSpec: ChangeSpecSchema.optional(),
    postApply: PostApplySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'dry_run') {
      if (!value.workflowId && !value.contextPackId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workflowId'],
          message: 'workflowId is required for dry_run when contextPackId is not provided',
        })
      }
      if (!value.changeSpec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['changeSpec'],
          message: 'changeSpec is required for dry_run',
        })
      }
      return
    }

    if (!value.proposalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalId'],
        message: 'proposalId is required for apply',
      })
    }
    if (!value.expectedSnapshotHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedSnapshotHash'],
        message: 'expectedSnapshotHash is required for apply',
      })
    }
  })

type WorkflowChangeParams = z.input<typeof WorkflowChangeInputSchema>
type ChangeSpec = z.input<typeof ChangeSpecSchema>
type TargetRef = z.input<typeof TargetSchema>
type ChangeOperation = z.input<typeof ChangeOperationSchema>
type PostApply = z.input<typeof PostApplySchema>

type NormalizedPostApply = {
  verify: boolean
  run: {
    enabled: boolean
    mode: 'full' | 'until_block' | 'from_block' | 'block'
    useDeployedState: boolean
    workflowInput?: Record<string, any>
    stopAfterBlockId?: string
    startBlockId?: string
    blockId?: string
  }
  evaluator: {
    enabled: boolean
    requireVerified: boolean
    maxWarnings: number
    maxDiagnostics: number
    requireRunSuccess: boolean
  }
}

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTAINER_INPUT_FIELDS: Record<string, string[]> = {
  loop: ['loopType', 'iterations', 'collection', 'condition'],
  parallel: ['parallelType', 'count', 'collection'],
}

function createDraftBlockId(_seed?: string): string {
  return crypto.randomUUID()
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

function isContainerBlockType(blockType: string | null | undefined): boolean {
  return blockType === 'loop' || blockType === 'parallel'
}

type ReferenceValidationContext = {
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
}

function createSerializedBlockForReferenceValidation(
  blockId: string,
  block: Record<string, any>
): SerializedBlock | null {
  const blockType = typeof block.type === 'string' ? block.type : ''
  if (!blockType) {
    return null
  }

  const params = Object.fromEntries(
    Object.entries(block.subBlocks || {}).map(([subBlockId, subBlock]) => [
      subBlockId,
      (subBlock as { value?: unknown })?.value,
    ])
  )

  return {
    id: blockId,
    position: { x: 0, y: 0 },
    config: {
      tool: blockType,
      params,
    },
    inputs: {},
    outputs: {},
    metadata: {
      id: blockType,
      name: typeof block.name === 'string' ? block.name : blockId,
    },
    enabled: typeof block.enabled === 'boolean' ? block.enabled : true,
  }
}

function buildReferenceValidationContext(workflowState: {
  blocks: Record<string, any>
}): ReferenceValidationContext {
  const blockNameMapping: Record<string, string> = {}
  const blockOutputSchemas: Record<string, OutputSchema> = {}

  for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
    const serializedBlock = createSerializedBlockForReferenceValidation(
      blockId,
      block as Record<string, any>
    )
    if (!serializedBlock) {
      continue
    }

    blockNameMapping[normalizeName(blockId)] = blockId
    const blockName = String((block as Record<string, unknown>).name || '').trim()
    if (blockName) {
      blockNameMapping[normalizeName(blockName)] = blockId
    }

    const schema = getBlockSchema(serializedBlock)
    if (schema && Object.keys(schema).length > 0) {
      blockOutputSchemas[blockId] = schema
    }
  }

  return {
    blockNameMapping,
    blockOutputSchemas,
  }
}

function extractLikelyReferences(value: string): string[] {
  const references = new Set<string>()
  replaceValidReferences(value, (match) => {
    references.add(match.trim())
    return match
  })
  return [...references]
}

function validateReference(
  reference: string,
  context: ReferenceValidationContext
): string | null {
  const trimmed = reference.trim()
  const parts = parseReferencePath(trimmed)
  if (parts.length === 0) {
    return null
  }

  const [head, ...pathParts] = parts
  if (!head) {
    return null
  }

  // Keep variable/loop/parallel references warning-free at compile time because
  // they can be context-dependent and <...> may also be used for non-variable text.
  if (
    head === REFERENCE.PREFIX.VARIABLE ||
    head === REFERENCE.PREFIX.LOOP ||
    head === REFERENCE.PREFIX.PARALLEL
  ) {
    return null
  }

  try {
    const result = resolveBlockReference(head, pathParts, {
      blockNameMapping: context.blockNameMapping,
      blockData: {},
      blockOutputSchemas: context.blockOutputSchemas,
    })
    if (!result) {
      return `reference "${trimmed}" points to unknown block "${head}"`
    }
    return null
  } catch (error) {
    if (error instanceof InvalidFieldError) {
      return (
        `reference "${trimmed}" has invalid field path "${error.fieldPath}" ` +
        `for block "${error.blockName}". ` +
        `Available fields: ${error.availableFields.length > 0 ? error.availableFields.join(', ') : 'none'}`
      )
    }
    return `reference "${trimmed}" could not be validated`
  }
}

function collectReferenceWarningsForValue(params: {
  value: unknown
  location: string
  context: ReferenceValidationContext
  sink: Set<string>
}): void {
  const { value, location, context, sink } = params
  if (typeof value === 'string') {
    const references = extractLikelyReferences(value)
    for (const reference of references) {
      const warning = validateReference(reference, context)
      if (warning) {
        sink.add(`${location}: ${warning}`)
      }
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectReferenceWarningsForValue({
        value: item,
        location: `${location}[${index}]`,
        context,
        sink,
      })
    })
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectReferenceWarningsForValue({
        value: child,
        location: `${location}.${key}`,
        context,
        sink,
      })
    }
  }
}

function collectReferenceWarningsForChangeSpec(params: {
  changeSpec: ChangeSpec
  workflowState: { blocks: Record<string, any> }
}): string[] {
  const { changeSpec, workflowState } = params
  const context = buildReferenceValidationContext(workflowState)
  const warnings = new Set<string>()

  for (const [mutationIndex, mutation] of (changeSpec.mutations || []).entries()) {
    if (mutation.action === 'ensure_block' || mutation.action === 'insert_into_subflow') {
      if (mutation.inputs) {
        collectReferenceWarningsForValue({
          value: mutation.inputs,
          location: `mutations[${mutationIndex}].inputs`,
          context,
          sink: warnings,
        })
      }
      continue
    }

    if (mutation.action === 'patch_block') {
      for (const [changeIndex, change] of mutation.changes.entries()) {
        collectReferenceWarningsForValue({
          value: change.value,
          location: `mutations[${mutationIndex}].changes[${changeIndex}].value`,
          context,
          sink: warnings,
        })
      }
    }
  }

  return [...warnings]
}

function normalizeAcceptance(assertions: ChangeSpec['acceptance'] | undefined): string[] {
  if (!Array.isArray(assertions)) return []
  const toCanonicalAssertion = (
    item: string | { kind?: string; assert: string } | undefined
  ): string | null => {
    if (!item) return null
    const rawAssert = typeof item === 'string' ? item : item.assert
    if (typeof rawAssert !== 'string' || rawAssert.trim().length === 0) return null
    const assert = rawAssert.trim()
    const kind = typeof item === 'string' ? '' : String(item.kind || '').trim().toLowerCase()

    const normalizeKnown = (value: string): string => {
      if (
        value.startsWith('block_exists:') ||
        value.startsWith('block_type_exists:') ||
        value.startsWith('path_exists:') ||
        value.startsWith('trigger_exists:')
      ) {
        return value
      }
      return ''
    }

    const known = normalizeKnown(assert)
    if (known) return known

    if (kind === 'block_exists') return `block_exists:${assert}`
    if (kind === 'block_type_exists') return `block_type_exists:${assert}`
    if (kind === 'path_exists') return `path_exists:${assert}`
    if (kind === 'trigger_exists') return `trigger_exists:${assert}`

    // Shorthand compatibility: if assertion looks like A->B, treat as path_exists.
    if (assert.includes('->')) {
      return `path_exists:${assert}`
    }
    // Single token fallback defaults to block_exists.
    return `block_exists:${assert}`
  }

  return assertions
    .map((item) => (typeof item === 'string' ? toCanonicalAssertion(item) : toCanonicalAssertion(item)))
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function materializeAcceptanceAssertions(
  assertions: string[],
  resolvedIds?: Record<string, string>
): string[] {
  if (!resolvedIds || Object.keys(resolvedIds).length === 0) {
    return assertions
  }

  const resolveToken = (token: string): string => {
    const trimmed = token.trim()
    return resolvedIds[trimmed] || trimmed
  }

  return assertions.map((assertion) => {
    if (assertion.startsWith('block_exists:')) {
      const token = assertion.slice('block_exists:'.length)
      return `block_exists:${resolveToken(token)}`
    }

    if (assertion.startsWith('path_exists:')) {
      const rawPath = assertion.slice('path_exists:'.length).trim()
      const mapped = rawPath
        .split('->')
        .map((token) => resolveToken(token))
        .join('->')
      return `path_exists:${mapped}`
    }

    return assertion
  })
}

function normalizePostApply(postApply?: PostApply): NormalizedPostApply {
  const run = postApply?.run
  const evaluator = postApply?.evaluator

  return {
    // Verification is mandatory for apply mode to keep mutation semantics deterministic.
    verify: true,
    run: {
      enabled: run?.enabled === true,
      mode: run?.mode || 'full',
      useDeployedState: run?.useDeployedState === true,
      workflowInput:
        run?.workflowInput && typeof run.workflowInput === 'object'
          ? (run.workflowInput as Record<string, any>)
          : undefined,
      stopAfterBlockId: run?.stopAfterBlockId,
      startBlockId: run?.startBlockId,
      blockId: run?.blockId,
    },
    evaluator: {
      enabled: evaluator?.enabled !== false,
      requireVerified: evaluator?.requireVerified !== false,
      maxWarnings:
        typeof evaluator?.maxWarnings === 'number' && evaluator.maxWarnings >= 0
          ? evaluator.maxWarnings
          : 50,
      maxDiagnostics:
        typeof evaluator?.maxDiagnostics === 'number' && evaluator.maxDiagnostics >= 0
          ? evaluator.maxDiagnostics
          : 0,
      requireRunSuccess: evaluator?.requireRunSuccess === true,
    },
  }
}

async function executePostApplyRun(params: {
  workflowId: string
  userId: string
  run: NormalizedPostApply['run']
}): Promise<ToolCallResult> {
  const context: ExecutionContext = {
    userId: params.userId,
    workflowId: params.workflowId,
  }

  switch (params.run.mode) {
    case 'until_block': {
      if (!params.run.stopAfterBlockId) {
        return {
          success: false,
          error: 'postApply.run.stopAfterBlockId is required for mode "until_block"',
        }
      }
      return executeRunWorkflowUntilBlock(
        {
          workflowId: params.workflowId,
          stopAfterBlockId: params.run.stopAfterBlockId,
          useDeployedState: params.run.useDeployedState,
          workflow_input: params.run.workflowInput,
        },
        context
      )
    }
    case 'from_block': {
      if (!params.run.startBlockId) {
        return {
          success: false,
          error: 'postApply.run.startBlockId is required for mode "from_block"',
        }
      }
      return executeRunFromBlock(
        {
          workflowId: params.workflowId,
          startBlockId: params.run.startBlockId,
          useDeployedState: params.run.useDeployedState,
          workflow_input: params.run.workflowInput,
        },
        context
      )
    }
    case 'block': {
      if (!params.run.blockId) {
        return {
          success: false,
          error: 'postApply.run.blockId is required for mode "block"',
        }
      }
      return executeRunBlock(
        {
          workflowId: params.workflowId,
          blockId: params.run.blockId,
          useDeployedState: params.run.useDeployedState,
          workflow_input: params.run.workflowInput,
        },
        context
      )
    }
    default:
      return executeRunWorkflow(
        {
          workflowId: params.workflowId,
          useDeployedState: params.run.useDeployedState,
          workflow_input: params.run.workflowInput,
        },
        context
      )
  }
}

function evaluatePostApplyGate(params: {
  verifyEnabled: boolean
  verifyResult: any | null
  runEnabled: boolean
  runResult: ToolCallResult | null
  evaluator: NormalizedPostApply['evaluator']
  warnings: string[]
  diagnostics: string[]
}): {
  passed: boolean
  reasons: string[]
  summary: string
} {
  if (!params.evaluator.enabled) {
    return {
      passed: true,
      reasons: [],
      summary: 'Evaluator gate disabled',
    }
  }

  const reasons: string[] = []

  if (params.verifyEnabled && params.evaluator.requireVerified) {
    const verified = params.verifyResult?.verified === true
    if (!verified) {
      reasons.push('verification_failed')
    }
  }

  if (params.warnings.length > params.evaluator.maxWarnings) {
    reasons.push(`warnings_exceeded:${params.warnings.length}`)
  }

  if (params.diagnostics.length > params.evaluator.maxDiagnostics) {
    reasons.push(`diagnostics_exceeded:${params.diagnostics.length}`)
  }

  if (params.runEnabled && params.evaluator.requireRunSuccess) {
    if (!params.runResult || params.runResult.success !== true) {
      reasons.push('run_failed')
    }
  }

  const passed = reasons.length === 0
  return {
    passed,
    reasons,
    summary: passed ? 'Evaluator gate passed' : `Evaluator gate failed: ${reasons.join(', ')}`,
  }
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
  const normalizeToken = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim()

  if (target.blockId && workflowState.blocks[target.blockId]) {
    return target.blockId
  }

  if (target.alias) {
    const aliasNorm = normalizeToken(target.alias)
    if (aliasNorm) {
      const aliasMatches = Object.entries(workflowState.blocks || {}).filter(([blockId, block]) => {
        const blockName = String((block as Record<string, unknown>).name || '')
        const blockIdNorm = normalizeToken(blockId)
        const blockNameNorm = normalizeToken(blockName)
        return blockIdNorm === aliasNorm || blockNameNorm === aliasNorm
      })
      if (aliasMatches.length === 1) {
        return aliasMatches[0][0]
      }
      if (aliasMatches.length > 1) {
        throw new Error(
          `ambiguous_target: alias "${target.alias}" resolved to ${aliasMatches.length} blocks ` +
            `(${aliasMatches.map(([id]) => id).join(', ')})`
        )
      }
    }
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

function normalizePathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function providerMatches(providerCandidate: string, requestedProvider: string): boolean {
  const candidate = providerCandidate.toLowerCase()
  const requested = requestedProvider.toLowerCase()
  return candidate === requested || candidate.startsWith(`${requested}-`)
}

function parseToolInputPath(path: string | undefined): {
  fieldId: string
  explicitIndex: number | null
  credentialPathFromPath: string[]
} | null {
  if (!path) return null
  const segments = normalizePathSegments(path)
  if (segments[0] !== 'inputs' || !segments[1]) return null
  const hasExplicitIndex = segments[2] && /^\d+$/.test(segments[2])
  const explicitIndex = hasExplicitIndex ? Number.parseInt(segments[2], 10) : null
  const credentialPathFromPath = hasExplicitIndex ? segments.slice(3) : segments.slice(2)
  return { fieldId: segments[1], explicitIndex, credentialPathFromPath }
}

function selectToolInputField(blockType: string, path: string | undefined): {
  fieldId: string
  explicitIndex: number | null
  credentialPathFromPath: string[]
} | null {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return null

  const toolInputFields = (blockConfig.subBlocks || [])
    .filter((subBlock) => subBlock.type === 'tool-input')
    .map((subBlock) => subBlock.id)

  if (toolInputFields.length === 0) return null

  if (path) {
    const parsedPath = parseToolInputPath(path)
    if (!parsedPath) return null
    if (!toolInputFields.includes(parsedPath.fieldId)) return null
    return parsedPath
  }

  if (toolInputFields.length === 1) {
    return { fieldId: toolInputFields[0], explicitIndex: null, credentialPathFromPath: [] }
  }

  return null
}

function coerceToolInputArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toolMatchesSelector(
  tool: Record<string, any>,
  selector: z.infer<typeof ToolCredentialTargetSchema>
): boolean {
  if (selector.toolId && String(tool.toolId || '') !== selector.toolId) return false
  if (selector.type && String(tool.type || '') !== selector.type) return false
  if (
    selector.operation &&
    String(tool.operation || '').toLowerCase() !== selector.operation.toLowerCase()
  ) {
    return false
  }
  if (selector.title) {
    const title = String(tool.title || '').toLowerCase()
    const query = selector.title.toLowerCase()
    if (!title.includes(query)) return false
  }
  return true
}

function toolOAuthProvider(tool: Record<string, any>): string | null {
  const toolId = typeof tool.toolId === 'string' ? tool.toolId : ''
  if (!toolId) return null
  const toolConfig = getTool(toolId)
  return toolConfig?.oauth?.provider || null
}

function selectToolIndexForCredentialAttach(params: {
  tools: Record<string, any>[]
  selector: z.infer<typeof ToolCredentialTargetSchema> | undefined
  explicitIndex: number | null
  provider: string
}): { index: number | null; warning?: string; error?: string } {
  const { tools, selector, explicitIndex, provider } = params
  if (tools.length === 0) {
    return { index: null, error: 'tool-input array is empty' }
  }

  const providerMatchedIndexes = tools
    .map((tool, index) => ({ index, provider: toolOAuthProvider(tool) }))
    .filter((entry) => Boolean(entry.provider && providerMatches(entry.provider!, provider)))
    .map((entry) => entry.index)

  if (explicitIndex !== null) {
    if (explicitIndex < 0 || explicitIndex >= tools.length) {
      return {
        index: null,
        error: `tool index ${explicitIndex} is out of range (tool count: ${tools.length})`,
      }
    }
    if (selector && !toolMatchesSelector(tools[explicitIndex], selector)) {
      return {
        index: null,
        error: `tool index ${explicitIndex} does not match the provided tool selector`,
      }
    }
    return { index: explicitIndex }
  }

  if (selector?.index !== undefined) {
    const index = selector.index
    if (index < 0 || index >= tools.length) {
      return {
        index: null,
        error: `tool selector index ${index} is out of range (tool count: ${tools.length})`,
      }
    }
    const candidate = tools[index]
    if (!toolMatchesSelector(candidate, selector)) {
      return {
        index: null,
        error: `tool selector index ${index} does not match the provided selector fields`,
      }
    }
    return { index }
  }

  const baseCandidates = tools
    .map((tool, index) => ({ index, tool }))
    .filter((candidate) => (selector ? toolMatchesSelector(candidate.tool, selector) : true))
    .map((candidate) => candidate.index)

  if (baseCandidates.length === 0) {
    return { index: null, error: 'tool selector did not match any tool in tool-input array' }
  }

  const providerCandidates = baseCandidates.filter((index) => providerMatchedIndexes.includes(index))
  if (providerCandidates.length === 1) {
    return { index: providerCandidates[0] }
  }
  if (providerCandidates.length > 1) {
    return {
      index: null,
      error: `tool selector + provider "${provider}" matched multiple tools (${providerCandidates.join(', ')})`,
    }
  }

  if (baseCandidates.length === 1) {
    return {
      index: baseCandidates[0],
      warning:
        `selected tool at index ${baseCandidates[0]} does not advertise oauth provider "${provider}"` +
        '; credential was attached to the selected tool anyway',
    }
  }

  if (!selector && providerMatchedIndexes.length === 1) {
    return { index: providerMatchedIndexes[0] }
  }

  return {
    index: null,
    error:
      `ambiguous tool target for provider "${provider}" (${baseCandidates.length} candidates). ` +
      'Specify changes[].tool (index/toolId/type/title/operation) or path with an explicit index.',
  }
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
  schemaContext: {
    contextPackProvided: boolean
    loadedSchemaTypes: Set<string>
  }
}): Promise<{
  operations: Array<Record<string, any>>
  warnings: string[]
  diagnostics: string[]
  touchedBlocks: string[]
  resolvedIds: Record<string, string>
}> {
  const { changeSpec, workflowState, userId, workflowId, schemaContext } = params
  const operations: Array<Record<string, any>> = []
  const diagnostics: string[] = []
  const warnings: string[] = []
  const touchedBlocks = new Set<string>()
  const resolvedIds: Record<string, string> = { ...(changeSpec.resolvedIds || {}) }

  const aliasMap = new Map<string, string>()
  const workingState = deepClone(workflowState)
  const connectionState = buildConnectionState(workingState)
  const connectionTouchedSources = new Set<string>()
  const plannedBlockTypes = new Map<string, string>()
  const schemaFallbackLogged = new Set<string>()

  const isSchemaLoaded = (blockType: string | null): boolean =>
    Boolean(blockType && schemaContext.loadedSchemaTypes.has(blockType))

  const requireSchema = (
    targetId: string,
    blockType: string | null,
    operationName: 'patch_block' | 'ensure_block'
  ): boolean => {
    if (!blockType) {
      diagnostics.push(`${operationName} on ${targetId} failed: unknown block type`)
      return false
    }
    if (isSchemaLoaded(blockType)) {
      return true
    }
    if (isContainerBlockType(blockType)) {
      return true
    }
    // Intelligence-first fallback: compiler can still validate against registry schema
    // even when context pack did not include that type.
    if (getBlock(blockType)) {
      if (!schemaFallbackLogged.has(blockType)) {
        schemaFallbackLogged.add(blockType)
        warnings.push(
          `${operationName} on ${targetId} used server schema for block type "${blockType}" ` +
            `(not present in context pack).`
        )
      }
      return true
    }
    if (schemaContext.contextPackProvided) {
      diagnostics.push(
        `${operationName} on ${targetId} failed: unknown schema for block type "${blockType}". ` +
          `Call workflow_context_expand with blockTypes:["${blockType}"] and retry dry_run.`
      )
      return false
    }
    diagnostics.push(
      `${operationName} on ${targetId} failed: unknown schema for block type "${blockType}". ` +
        `Call workflow_context_get, then workflow_context_expand for "${blockType}", ` +
        `then retry dry_run with contextPackId.`
    )
    return false
  }

  const normalizeInputsWithSchema = (
    targetId: string,
    blockType: string,
    inputs: Record<string, any>,
    operationName: 'patch_block' | 'ensure_block'
  ): Record<string, any> => {
    if (!requireSchema(targetId, blockType, operationName)) {
      return {}
    }
    const validation = validateInputsForBlock(blockType, inputs, targetId)
    for (const validationError of validation.errors) {
      diagnostics.push(
        `${operationName} on ${targetId} failed input validation: ${validationError.error}`
      )
    }
    return validation.validInputs
  }

  const recordResolved = (token: string | undefined, blockId: string | null | undefined): void => {
    if (!token || !blockId) return
    resolvedIds[token] = blockId
  }

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
      if (aliasMap.has(target.blockId)) {
        const mapped = aliasMap.get(target.blockId) || null
        recordResolved(target.blockId, mapped)
        return mapped
      }
      if (workingState.blocks[target.blockId] || plannedBlockTypes.has(target.blockId)) {
        recordResolved(target.blockId, target.blockId)
        return target.blockId
      }
      return allowCreateAlias ? target.blockId : null
    }

    if (target.alias) {
      if (aliasMap.has(target.alias)) {
        const mapped = aliasMap.get(target.alias) || null
        recordResolved(target.alias, mapped)
        return mapped
      }
      const byMatch = findMatchingBlockId(workingState, { alias: target.alias })
      if (byMatch) {
        aliasMap.set(target.alias, byMatch)
        recordResolved(target.alias, byMatch)
        return byMatch
      }
      return allowCreateAlias ? target.alias : null
    }

    const matched = findMatchingBlockId(workingState, target)
    if (matched) {
      if (target.match?.name) {
        recordResolved(target.match.name, matched)
      }
      return matched
    }
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
      if (!requireSchema(targetId, blockType, 'patch_block')) {
        return
      }

      const credentialId = selectCredentialId(availableCredentials, provider, change.selection)
      if (!credentialId) {
        const msg = `No credential found for provider "${provider}" on ${targetId}`
        if (change.required) diagnostics.push(msg)
        else warnings.push(msg)
        return
      }

      const blockConfig = getBlock(blockType)
      const attachPathSegments = change.path ? normalizePathSegments(change.path) : []
      const attachInputFieldId =
        attachPathSegments[0] === 'inputs' && attachPathSegments[1] ? attachPathSegments[1] : null
      const attachInputFieldType =
        attachInputFieldId && blockConfig
          ? (blockConfig.subBlocks || []).find((subBlock) => subBlock.id === attachInputFieldId)
              ?.type
          : null

      const nestedAttachRequested = Boolean(
        change.tool || change.credentialPath || attachInputFieldType === 'tool-input'
      )
      if (nestedAttachRequested) {
        const toolInputTarget = selectToolInputField(blockType, change.path)
        if (!toolInputTarget) {
          const guidance = change.path
            ? `Path "${change.path}" must reference a tool-input field (for example inputs.tools or inputs.notification).`
            : 'Block has no unique tool-input field. Provide path like "inputs.tools" and optional tool selector.'
          const msg = `attach_credential on ${targetId} failed for nested tool target: ${guidance}`
          if (change.required) diagnostics.push(msg)
          else warnings.push(msg)
          return
        }

        const currentToolsValue =
          paramsOut.inputs?.[toolInputTarget.fieldId] ??
          workingState.blocks[targetId]?.subBlocks?.[toolInputTarget.fieldId]?.value ??
          []
        const currentTools = coerceToolInputArray(currentToolsValue)
        if (!currentTools) {
          diagnostics.push(
            `attach_credential on ${targetId} failed: inputs.${toolInputTarget.fieldId} is not a valid tool-input array`
          )
          return
        }

        const normalizedTools = currentTools.map((tool) =>
          tool && typeof tool === 'object' && !Array.isArray(tool) ? { ...(tool as Record<string, any>) } : tool
        )
        if (
          normalizedTools.some(
            (tool) => !tool || typeof tool !== 'object' || Array.isArray(tool)
          )
        ) {
          diagnostics.push(
            `attach_credential on ${targetId} failed: inputs.${toolInputTarget.fieldId} contains invalid tool entries`
          )
          return
        }

        const selectionResult = selectToolIndexForCredentialAttach({
          tools: normalizedTools as Record<string, any>[],
          selector: change.tool,
          explicitIndex: toolInputTarget.explicitIndex,
          provider,
        })
        if (selectionResult.error || selectionResult.index === null) {
          const msg =
            `attach_credential on ${targetId} failed for inputs.${toolInputTarget.fieldId}: ` +
            (selectionResult.error || 'unable to resolve tool target')
          if (change.required) diagnostics.push(msg)
          else warnings.push(msg)
          return
        }
        if (selectionResult.warning) {
          warnings.push(
            `attach_credential on ${targetId} warning for inputs.${toolInputTarget.fieldId}: ${selectionResult.warning}`
          )
        }

        const credentialPathSegments = change.credentialPath
          ? normalizePathSegments(change.credentialPath)
          : toolInputTarget.credentialPathFromPath.length > 0
            ? toolInputTarget.credentialPathFromPath
            : ['params', 'credential']
        if (credentialPathSegments.length === 0) {
          diagnostics.push(
            `attach_credential on ${targetId} failed: credentialPath resolved to an empty path`
          )
          return
        }

        normalizedTools[selectionResult.index] = setNestedValue(
          normalizedTools[selectionResult.index],
          credentialPathSegments,
          credentialId
        )

        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs[toolInputTarget.fieldId] = normalizedTools
        return
      }

      if (
        change.path &&
        attachPathSegments.length > 0 &&
        attachInputFieldId &&
        attachInputFieldType !== 'oauth-input'
      ) {
        warnings.push(
          `attach_credential on ${targetId} ignored path "${change.path}" because it is not an oauth-input/tool-input field`
        )
      }

      if (attachInputFieldId && attachInputFieldType === 'oauth-input') {
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs[attachInputFieldId] = credentialId
        return
      }

      const credentialFieldId = selectCredentialFieldId(blockType, provider)
      if (!credentialFieldId) {
        const msg = `No oauth input field found for block type "${blockType}" on ${targetId}`
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
      if (!blockType) {
        diagnostics.push(`patch_block on ${targetId} failed: unknown block type`)
        return
      }
      if (!requireSchema(targetId, blockType, 'patch_block')) {
        return
      }
      const blockConfig = getBlock(blockType)
      const knownInputIds = new Set(
        blockConfig
          ? (blockConfig.subBlocks || []).map((subBlock) => subBlock.id)
          : CONTAINER_INPUT_FIELDS[blockType] || []
      )
      const allowsDynamicInputs = isContainerBlockType(blockType)
      if (!blockConfig && !allowsDynamicInputs) {
        diagnostics.push(`patch_block on ${targetId} failed: unknown block type "${blockType}"`)
        return
      }
      if (!allowsDynamicInputs && !knownInputIds.has(inputKey)) {
        const knownFields = [...knownInputIds].sort()
        const preview = knownFields.slice(0, 12).join(', ')
        const suffix = knownFields.length > 12 ? ', ...' : ''
        diagnostics.push(
          `Unknown input field "${inputKey}" for block type "${blockType}" on ${targetId} ` +
            `at path "${change.path}".${preview ? ` Known fields: ${preview}${suffix}` : ''}`
        )
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
      if (
        blockType === 'agent' &&
        ['systemPrompt', 'context', 'prompt', 'instructions', 'userPrompt'].includes(topLevelField)
      ) {
        diagnostics.push(
          `Unsupported agent field "${change.path}" on ${targetId}. ` +
            `Agent prompt configuration belongs in inputs.messages (messages-input), not top-level fields.`
        )
        return
      }
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
        if (mutation.inputs) {
          const targetBlockType =
            String(
              mutation.type ||
                workingState.blocks[targetId]?.type ||
                plannedBlockTypes.get(targetId) ||
                ''
            ) || ''
          const validatedInputs = normalizeInputsWithSchema(
            targetId,
            targetBlockType,
            mutation.inputs,
            'ensure_block'
          )
          if (Object.keys(validatedInputs).length > 0) {
            editParams.inputs = validatedInputs
          }
        }
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
        const requestedBlockId = mutation.target?.blockId
        const blockId =
          requestedBlockId && UUID_REGEX.test(requestedBlockId)
            ? requestedBlockId
            : createDraftBlockId(mutation.name)
        const addParams: Record<string, any> = {
          type: mutation.type,
          name: mutation.name,
        }
        let normalizedInputs: Record<string, any> | undefined
        if (mutation.inputs) {
          const validatedInputs = normalizeInputsWithSchema(
            targetId,
            mutation.type,
            mutation.inputs,
            'ensure_block'
          )
          if (Object.keys(validatedInputs).length > 0) {
            normalizedInputs = validatedInputs
            addParams.inputs = validatedInputs
          }
        }
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
            Object.entries(normalizedInputs || {}).map(([key, value]) => [
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
        if (requestedBlockId) {
          aliasMap.set(requestedBlockId, blockId)
          recordResolved(requestedBlockId, blockId)
        }
        if (mutation.target?.alias) {
          aliasMap.set(mutation.target.alias, blockId)
          recordResolved(mutation.target.alias, blockId)
        }
        recordResolved(targetId, blockId)
      }
      continue
    }

    if (mutation.action === 'patch_block') {
      const targetId = resolveTarget(mutation.target)
      if (!targetId) {
        diagnostics.push(
          'patch_block target could not be resolved. Use target.alias or target.match, ' +
            'or refresh workflow_context_get after prior apply before retrying.'
        )
        continue
      }
      const blockType =
        String(workingState.blocks[targetId]?.type || '') || plannedBlockTypes.get(targetId) || null

      const editParams: Record<string, any> = {}
      for (const change of mutation.changes || []) {
        applyPatchChange(targetId, blockType, change, editParams)
      }
      if (Object.keys(editParams).length === 0) {
        diagnostics.push(`patch_block for ${targetId} had no effective changes`)
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
        diagnostics.push(
          'remove_block target could not be resolved. Use target.alias or target.match, ' +
            'or refresh workflow_context_get after prior apply before retrying.'
        )
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

    if (mutation.action === 'insert_into_subflow') {
      const subflowId = resolveTarget(mutation.subflow)
      if (!subflowId) {
        diagnostics.push(
          'insert_into_subflow requires a resolvable subflow target (loop/parallel block).'
        )
        continue
      }

      const subflowType =
        String(workingState.blocks[subflowId]?.type || '') || plannedBlockTypes.get(subflowId) || ''
      if (subflowType !== 'loop' && subflowType !== 'parallel') {
        diagnostics.push(
          `insert_into_subflow target "${subflowId}" is type "${subflowType || 'unknown'}"; expected loop or parallel`
        )
        continue
      }

      const targetId = mutation.target ? resolveTarget(mutation.target, true) : null
      if (mutation.target && !targetId) {
        diagnostics.push(
          'insert_into_subflow target could not be resolved. Use target.alias/target.match, ' +
            'or omit target and provide type+name to create directly inside the subflow.'
        )
        continue
      }

      const existingBlock = targetId ? workingState.blocks[targetId] : undefined
      if (targetId && existingBlock) {
        const existingTargetId = targetId
        const existingType =
          String(existingBlock.type || '') ||
          plannedBlockTypes.get(existingTargetId) ||
          mutation.type ||
          ''
        if (!existingType) {
          diagnostics.push(`insert_into_subflow on ${existingTargetId} failed: unknown block type`)
          continue
        }
        const existingName = String(mutation.name || existingBlock.name || '').trim()
        if (!existingName) {
          diagnostics.push(`insert_into_subflow on ${existingTargetId} failed: missing block name`)
          continue
        }

        const insertParams: Record<string, any> = {
          subflowId,
          type: existingType,
          name: existingName,
        }
        if (mutation.inputs) {
          const validatedInputs = normalizeInputsWithSchema(
            existingTargetId,
            existingType,
            mutation.inputs,
            'patch_block'
          )
          if (Object.keys(validatedInputs).length > 0) {
            insertParams.inputs = validatedInputs
          }
        }
        if (mutation.triggerMode !== undefined) insertParams.triggerMode = mutation.triggerMode
        if (mutation.advancedMode !== undefined) insertParams.advancedMode = mutation.advancedMode
        if (mutation.enabled !== undefined) insertParams.enabled = mutation.enabled

        operations.push({
          operation_type: 'insert_into_subflow',
          block_id: existingTargetId,
          params: insertParams,
        })
        workingState.blocks[existingTargetId] = {
          ...existingBlock,
          data: { ...(existingBlock.data || {}), parentId: subflowId, extent: 'parent' },
        }
        touchedBlocks.add(existingTargetId)
        touchedBlocks.add(subflowId)
        continue
      }

      if (!mutation.type || !mutation.name) {
        diagnostics.push(
          `insert_into_subflow requires type and name when creating a new child block` +
            (targetId ? ` (target: "${targetId}")` : '')
        )
        continue
      }

      const requestedBlockId = mutation.target?.blockId
      const blockId =
        requestedBlockId && UUID_REGEX.test(requestedBlockId)
          ? requestedBlockId
          : createDraftBlockId(mutation.name)
      const insertParams: Record<string, any> = {
        subflowId,
        type: mutation.type,
        name: mutation.name,
      }
      let normalizedInputs: Record<string, any> | undefined
      if (mutation.inputs) {
        const validatedInputs = normalizeInputsWithSchema(
          targetId || blockId,
          mutation.type,
          mutation.inputs,
          'ensure_block'
        )
        if (Object.keys(validatedInputs).length > 0) {
          normalizedInputs = validatedInputs
          insertParams.inputs = validatedInputs
        }
      }
      if (mutation.triggerMode !== undefined) insertParams.triggerMode = mutation.triggerMode
      if (mutation.advancedMode !== undefined) insertParams.advancedMode = mutation.advancedMode
      if (mutation.enabled !== undefined) insertParams.enabled = mutation.enabled

      operations.push({
        operation_type: 'insert_into_subflow',
        block_id: blockId,
        params: insertParams,
      })
      workingState.blocks[blockId] = {
        id: blockId,
        type: mutation.type,
        name: mutation.name,
        subBlocks: Object.fromEntries(
          Object.entries(normalizedInputs || {}).map(([key, value]) => [
            key,
            { id: key, value, type: 'short-input' },
          ])
        ),
        triggerMode: mutation.triggerMode || false,
        advancedMode: mutation.advancedMode || false,
        enabled: mutation.enabled !== undefined ? mutation.enabled : true,
        data: { parentId: subflowId, extent: 'parent' },
      }
      plannedBlockTypes.set(blockId, mutation.type)
      touchedBlocks.add(blockId)
      touchedBlocks.add(subflowId)
      if (requestedBlockId) {
        aliasMap.set(requestedBlockId, blockId)
        recordResolved(requestedBlockId, blockId)
      }
      if (mutation.target?.alias) {
        aliasMap.set(mutation.target.alias, blockId)
        recordResolved(mutation.target.alias, blockId)
      }
      if (targetId) {
        recordResolved(targetId, blockId)
      }
      continue
    }

    if (mutation.action === 'extract_from_subflow') {
      const targetId = resolveTarget(mutation.target)
      if (!targetId) {
        diagnostics.push(
          'extract_from_subflow target could not be resolved. Use target.alias or target.match, ' +
            'or refresh workflow_context_get after prior apply before retrying.'
        )
        continue
      }

      const targetBlock = workingState.blocks[targetId]
      const inferredSubflowId = String(targetBlock?.data?.parentId || '')
      const explicitSubflowId = mutation.subflow ? resolveTarget(mutation.subflow) : null
      const subflowId = explicitSubflowId || inferredSubflowId || null
      if (!subflowId) {
        diagnostics.push(
          `extract_from_subflow on ${targetId} requires subflow selector or a target currently inside a loop/parallel`
        )
        continue
      }

      const subflowType =
        String(workingState.blocks[subflowId]?.type || '') || plannedBlockTypes.get(subflowId) || ''
      if (subflowType !== 'loop' && subflowType !== 'parallel') {
        diagnostics.push(
          `extract_from_subflow subflow "${subflowId}" is type "${subflowType || 'unknown'}"; expected loop or parallel`
        )
        continue
      }

      operations.push({
        operation_type: 'extract_from_subflow',
        block_id: targetId,
        params: {
          subflowId,
        },
      })

      if (targetBlock) {
        const nextData = { ...(targetBlock.data || {}) }
        delete nextData.parentId
        delete nextData.extent
        workingState.blocks[targetId] = {
          ...targetBlock,
          data: nextData,
        }
      }

      touchedBlocks.add(targetId)
      touchedBlocks.add(subflowId)
      continue
    }

    if (mutation.action === 'connect' || mutation.action === 'disconnect') {
      const from = resolveTarget(mutation.from)
      const to = resolveTarget(mutation.to)
      if (!from || !to) {
        diagnostics.push(
          `${mutation.action} requires resolvable from/to targets. Prefer alias/match selectors, ` +
            'or refresh workflow_context_get after prior apply before retrying.'
        )
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
      const mode =
        mutation.action === 'disconnect' ? 'remove' : ('mode' in mutation ? mutation.mode : undefined) || 'set'
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
      diagnostics.push(
        'link contains unresolved from/to target. Prefer alias/match selectors, ' +
          'or refresh workflow_context_get after prior apply before retrying.'
      )
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

  const referenceWarnings = collectReferenceWarningsForChangeSpec({
    changeSpec,
    workflowState: workingState,
  })
  warnings.push(...referenceWarnings)

  return {
    operations,
    warnings,
    diagnostics,
    touchedBlocks: [...touchedBlocks],
    resolvedIds,
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
    diagnostics.push(error.error)
  }

  const { state, validationErrors, skippedItems } = applyOperationsToWorkflowState(
    params.workflowState,
    filteredOperations as any,
    permissionConfig
  )

  for (const validationError of validationErrors) {
    diagnostics.push(validationError.error)
  }
  for (const skippedItem of skippedItems) {
    diagnostics.push(skippedItem.reason)
  }

  if (Object.keys(state.blocks || {}).length === 0) {
    diagnostics.push('Simulation produced an empty workflow state')
  }
  const beforeHash = hashWorkflowState(params.workflowState as unknown as Record<string, unknown>)
  const afterHash = hashWorkflowState(state as unknown as Record<string, unknown>)
  if (beforeHash === afterHash) {
    diagnostics.push('Simulation produced no effective workflow changes')
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
      const contextPack = params.contextPackId
        ? await getContextPack(params.contextPackId)
        : null
      const workflowId = params.workflowId || contextPack?.workflowId
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
        schemaContext: {
          contextPackProvided: Boolean(contextPack),
          loadedSchemaTypes: new Set(Object.keys(contextPack?.schemasByType || {})),
        },
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
      const acceptanceAssertions = normalizeAcceptance(params.changeSpec.acceptance)
      const materializedAcceptance = materializeAcceptanceAssertions(
        acceptanceAssertions,
        compileResult.resolvedIds
      )
      const normalizedPostApply = normalizePostApply(
        (params.postApply as PostApply | undefined) || params.changeSpec.postApply
      )

      const proposal: WorkflowChangeProposal = {
        workflowId,
        baseSnapshotHash: currentHash,
        compiledOperations: simulation.operationsForApply,
        diffSummary,
        warnings,
        diagnostics,
        touchedBlocks: compileResult.touchedBlocks,
        resolvedIds: compileResult.resolvedIds,
        acceptanceAssertions: materializedAcceptance,
        postApply: normalizedPostApply,
        handoff: {
          objective: params.changeSpec.objective,
          constraints: params.changeSpec.constraints,
          resolvedIds: compileResult.resolvedIds,
          assumptions: params.changeSpec.assumptions,
          unresolvedRisks: params.changeSpec.unresolvedRisks,
        },
      }
      const proposalId = await saveProposal(proposal)

      logger.info('Compiled workflow_change dry run', {
        workflowId,
        proposalId,
        operationCount: proposal.compiledOperations.length,
        warningCount: warnings.length,
        diagnosticsCount: diagnostics.length,
        acceptanceCount: acceptanceAssertions.length,
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
        resolvedIds: proposal.resolvedIds || {},
        acceptance: materializedAcceptance,
        postApply: normalizedPostApply,
        handoff: proposal.handoff,
      }
    }

    // apply mode
    const proposalId = params.proposalId
    if (!proposalId) {
      throw new Error('proposalId is required for apply')
    }

    const proposal = await getProposal(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found or expired: ${proposalId}`)
    }
    if (Array.isArray(proposal.diagnostics) && proposal.diagnostics.length > 0) {
      throw new Error(
        `proposal_invalid: proposal contains diagnostics (${proposal.diagnostics.length}). ` +
          `Fix dry_run diagnostics before apply.`
      )
    }
    if (!Array.isArray(proposal.compiledOperations) || proposal.compiledOperations.length === 0) {
      throw new Error('proposal_invalid: proposal contains no operations to apply')
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
    const expectedHash = params.expectedSnapshotHash
    if (expectedHash !== proposal.baseSnapshotHash) {
      throw new Error(
        `snapshot_mismatch: expectedSnapshotHash ${expectedHash} does not match proposal base ${proposal.baseSnapshotHash}`
      )
    }
    if (expectedHash !== currentHash) {
      throw new Error(`snapshot_mismatch: expected ${expectedHash} but current is ${currentHash}`)
    }

    const applyResult = await applyWorkflowOperations({
      workflowId: proposal.workflowId,
      operations: proposal.compiledOperations as any,
      userId: context.userId,
    })

    const resolvedIds = proposal.resolvedIds || proposal.handoff?.resolvedIds || {}
    const acceptanceAssertions = materializeAcceptanceAssertions(
      proposal.acceptanceAssertions,
      resolvedIds
    )

    // Canonicalize post-apply state from persisted DB snapshot to avoid
    // in-memory serialization drift and transient hash mismatches.
    const { workflowState: persistedWorkflowState } = await loadWorkflowStateFromDb(proposal.workflowId)
    const newSnapshotHash = hashWorkflowState(
      persistedWorkflowState as unknown as Record<string, unknown>
    )
    const normalizedPostApply = normalizePostApply(
      (params.postApply as PostApply | undefined) || (proposal.postApply as PostApply | undefined)
    )

    let verifyResult: any | null = null
    if (normalizedPostApply.verify) {
      verifyResult = await workflowVerifyServerTool.execute(
        {
          workflowId: proposal.workflowId,
          // Intentionally omit baseSnapshotHash for same-request post-apply verification
          // to avoid false negatives from benign persistence reorderings.
          acceptance: acceptanceAssertions,
        },
        { userId: context.userId }
      )
    }

    let runResult: ToolCallResult | null = null
    if (normalizedPostApply.run.enabled) {
      runResult = await executePostApplyRun({
        workflowId: proposal.workflowId,
        userId: context.userId,
        run: normalizedPostApply.run,
      })
    }

    const evaluatorGate = evaluatePostApplyGate({
      verifyEnabled: normalizedPostApply.verify,
      verifyResult,
      runEnabled: normalizedPostApply.run.enabled,
      runResult,
      evaluator: normalizedPostApply.evaluator,
      warnings: proposal.warnings,
      diagnostics: proposal.diagnostics,
    })

    return {
      success: evaluatorGate.passed,
      mode: 'apply',
      workflowId: proposal.workflowId,
      proposalId,
      baseSnapshotHash: proposal.baseSnapshotHash,
      newSnapshotHash,
      operations: proposal.compiledOperations,
      workflowState: persistedWorkflowState || null,
      appliedDiff: proposal.diffSummary,
      warnings: proposal.warnings,
      diagnostics: proposal.diagnostics,
      resolvedIds,
      acceptance: acceptanceAssertions,
      editResult: applyResult,
      postApply: {
        ok: evaluatorGate.passed,
        policy: normalizedPostApply,
        verify: verifyResult,
        run: runResult,
        evaluator: evaluatorGate,
      },
      handoff: proposal.handoff,
    }
  },
}
