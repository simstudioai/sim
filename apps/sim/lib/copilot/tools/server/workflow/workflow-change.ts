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
import { isAnnotationOnlyBlock, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import { getBlockSchema } from '@/executor/utils/block-data'
import { InvalidFieldError, type OutputSchema, resolveBlockReference } from '@/executor/utils/block-reference'
import {
  createEnvVarPattern,
  createReferencePattern,
} from '@/executor/utils/reference-validation'
import { isLikelyReferenceSegment } from '@/lib/workflows/sanitization/references'
import { detectDirectedCycle } from '@/lib/workflows/sanitization/graph-validation'
import {
  getContextPack,
  getProposal,
  saveProposal,
  type WorkflowChangeProposal,
} from './change-store'
import { applyWorkflowOperations } from './workflow-operations/apply'
import { applyOperationsToWorkflowState } from './workflow-operations/engine'
import {
  preValidateCredentialInputs,
  validateConditionHandle,
  validateInputsForBlock,
  validateRouterHandle,
} from './workflow-operations/validation'
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
const CONTAINER_SOURCE_HANDLE_EXPECTED_TYPE: Record<string, 'loop' | 'parallel'> = {
  'loop-start-source': 'loop',
  'loop-end-source': 'loop',
  'parallel-start-source': 'parallel',
  'parallel-end-source': 'parallel',
}
const REFERENCE_PATH_WRAPPER_SEGMENTS = new Set([
  'input',
  'inputs',
  'output',
  'outputs',
  'response',
  'result',
  'results',
  'data',
  'payload',
  'body',
])
const CONTAINER_INPUT_FIELDS: Record<string, string[]> = {
  loop: ['loopType', 'iterations', 'collection', 'condition'],
  parallel: ['parallelType', 'count', 'collection'],
}
const LOOP_INPUT_KEY_ALIASES: Record<string, string> = {
  looptype: 'loopType',
  mode: 'loopType',
  kind: 'loopType',
  strategy: 'loopType',
  type: 'loopType',
  iterations: 'iterations',
  iteration: 'iterations',
  count: 'iterations',
  times: 'iterations',
  n: 'iterations',
  collection: 'collection',
  items: 'collection',
  list: 'collection',
  array: 'collection',
  iterable: 'collection',
  over: 'collection',
  source: 'collection',
  condition: 'condition',
  predicate: 'condition',
  expression: 'condition',
  whilecondition: 'condition',
  dowhilecondition: 'condition',
}
const PARALLEL_INPUT_KEY_ALIASES: Record<string, string> = {
  paralleltype: 'parallelType',
  mode: 'parallelType',
  kind: 'parallelType',
  strategy: 'parallelType',
  type: 'parallelType',
  count: 'count',
  iterations: 'count',
  branches: 'count',
  parallelism: 'count',
  workers: 'count',
  collection: 'collection',
  items: 'collection',
  list: 'collection',
  array: 'collection',
  iterable: 'collection',
  over: 'collection',
  source: 'collection',
}
const LOOP_MODE_ALIASES: Record<string, 'for' | 'forEach' | 'while' | 'doWhile'> = {
  for: 'for',
  fixed: 'for',
  count: 'for',
  numeric: 'for',
  foreach: 'forEach',
  iterate: 'forEach',
  iter: 'forEach',
  collection: 'forEach',
  while: 'while',
  dowhile: 'doWhile',
}
const PARALLEL_MODE_ALIASES: Record<string, 'count' | 'collection'> = {
  count: 'count',
  fixed: 'count',
  branch: 'count',
  branches: 'count',
  collection: 'collection',
  foreach: 'collection',
  iterate: 'collection',
  iter: 'collection',
}
const AGENT_LEGACY_PROMPT_FIELDS: Record<string, 'system' | 'user'> = {
  systemPrompt: 'system',
  instructions: 'system',
  context: 'system',
  prompt: 'user',
  userPrompt: 'user',
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

function normalizeAliasToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function isContainerBlockType(blockType: string | null | undefined): boolean {
  return blockType === 'loop' || blockType === 'parallel'
}

function canonicalizeContainerInputKey(blockType: string, key: string): string {
  const token = normalizeAliasToken(key)
  if (blockType === 'loop') {
    return LOOP_INPUT_KEY_ALIASES[token] || key
  }
  if (blockType === 'parallel') {
    return PARALLEL_INPUT_KEY_ALIASES[token] || key
  }
  return key
}

function canonicalizeLoopMode(value: unknown): 'for' | 'forEach' | 'while' | 'doWhile' | null {
  if (typeof value !== 'string') return null
  return LOOP_MODE_ALIASES[normalizeAliasToken(value)] || null
}

function canonicalizeParallelMode(value: unknown): 'count' | 'collection' | null {
  if (typeof value !== 'string') return null
  return PARALLEL_MODE_ALIASES[normalizeAliasToken(value)] || null
}

type AgentMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function normalizeAgentMessages(value: unknown): AgentMessage[] {
  const toMessageArray = (input: unknown): unknown[] => {
    if (Array.isArray(input)) return input
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (!trimmed) return []
      try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }

  const rawMessages = toMessageArray(value)
  return rawMessages
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const role = String((item as Record<string, unknown>).role || '').trim().toLowerCase()
      const content = String((item as Record<string, unknown>).content || '')
      if (!['system', 'user', 'assistant'].includes(role)) return null
      return { role: role as AgentMessage['role'], content }
    })
    .filter((item): item is AgentMessage => Boolean(item))
}

function toMessageContent(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function upsertAgentMessageByRole(
  messages: AgentMessage[],
  role: 'system' | 'user',
  content: string
): AgentMessage[] {
  const next = [...messages]
  const existingIndex = next.findIndex((message) => message.role === role)
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], content }
    return next
  }
  if (role === 'system') {
    return [{ role, content }, ...next]
  }
  return [...next, { role, content }]
}

function removeAgentMessagesByRole(
  messages: AgentMessage[],
  role: 'system' | 'user'
): AgentMessage[] {
  return messages.filter((message) => message.role !== role)
}

function normalizeLegacyAgentInputs(params: {
  targetId: string
  inputs: Record<string, any>
  warnings: string[]
}): Record<string, any> {
  const { targetId, inputs, warnings } = params
  if (!inputs || typeof inputs !== 'object') return inputs

  const nextInputs: Record<string, any> = { ...inputs }
  let messages = normalizeAgentMessages(nextInputs.messages)
  let converted = false

  for (const [legacyField, role] of Object.entries(AGENT_LEGACY_PROMPT_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(nextInputs, legacyField)) continue
    converted = true
    const rawValue = nextInputs[legacyField]
    if (rawValue == null) {
      messages = removeAgentMessagesByRole(messages, role)
    } else {
      messages = upsertAgentMessageByRole(messages, role, toMessageContent(rawValue))
    }
    delete nextInputs[legacyField]
    warnings.push(
      `Converted legacy agent input "${legacyField}" to inputs.messages on ${targetId}`
    )
  }

  if (converted) {
    nextInputs.messages = messages
  }

  return nextInputs
}

function parseArrayLikeInput(value: unknown): { items: unknown[] | null; fromJson: boolean } {
  if (Array.isArray(value)) {
    return { items: value, fromJson: false }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    // Accept common wrapper shapes produced by different model/tool patterns.
    // Examples: {options:[...]}, {rows:[...]}, {items:[...]}, {conditions:[...]}, {routes:[...]}
    for (const key of ['options', 'rows', 'items', 'conditions', 'branches', 'routes', 'value']) {
      const candidate = record[key]
      if (Array.isArray(candidate)) {
        return { items: candidate, fromJson: false }
      }
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        if (!trimmed) {
          continue
        }
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            return { items: parsed, fromJson: true }
          }
        } catch {
          // Not JSON; ignore and keep probing other wrapper keys.
        }
      }
    }
    // Accept a single row object and treat it as a one-item array.
    const looksLikeSingleRow =
      Object.prototype.hasOwnProperty.call(record, 'id') ||
      Object.prototype.hasOwnProperty.call(record, 'title') ||
      Object.prototype.hasOwnProperty.call(record, 'label') ||
      Object.prototype.hasOwnProperty.call(record, 'name') ||
      Object.prototype.hasOwnProperty.call(record, 'value') ||
      Object.prototype.hasOwnProperty.call(record, 'condition') ||
      Object.prototype.hasOwnProperty.call(record, 'expression') ||
      Object.prototype.hasOwnProperty.call(record, 'when')
    if (looksLikeSingleRow) {
      return { items: [record], fromJson: false }
    }
    return { items: null, fromJson: false }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return { items: [], fromJson: true }
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return { items: parsed, fromJson: true }
      }
      return { items: null, fromJson: true }
    } catch {
      return { items: null, fromJson: false }
    }
  }
  return { items: null, fromJson: false }
}

function normalizeConditionTitleForPosition(params: {
  rawTitle: unknown
  index: number
  total: number
}): {
  title: 'if' | 'else if' | 'else'
  overwritten: boolean
  rawTitleText: string
} {
  const { rawTitle, index, total } = params
  const rawTitleText = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  const expectedTitle: 'if' | 'else if' | 'else' =
    index === 0 ? 'if' : index === total - 1 ? 'else' : 'else if'
  const normalizedRawToken = normalizeAliasToken(rawTitleText)

  const tokenMatchesExpected = (() => {
    if (!normalizedRawToken) return false
    if (expectedTitle === 'if') {
      return normalizedRawToken === 'if'
    }
    if (expectedTitle === 'else if') {
      return normalizedRawToken === 'elseif' || normalizedRawToken.startsWith('elseif')
    }
    return normalizedRawToken === 'else'
  })()

  return {
    title: expectedTitle,
    overwritten: Boolean(rawTitleText) && !tokenMatchesExpected,
    rawTitleText,
  }
}

function normalizeConditionInputValue(params: {
  value: unknown
  targetId: string
  operationName: 'patch_block' | 'ensure_block'
}): {
  value: Array<{ id: string; title: string; value: string }> | unknown
  warnings: string[]
  diagnostics: string[]
} {
  const { value, targetId, operationName } = params
  const warnings: string[] = []
  const diagnostics: string[] = []

  const parsed = parseArrayLikeInput(value)
  let items = parsed.items
  if (!items && typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      items = [trimmed]
      warnings.push(
        `${operationName} on ${targetId} received non-JSON conditions string; treated as a single "if" condition expression`
      )
    }
  }

  if (!items) {
    diagnostics.push(
      `${operationName} on ${targetId} has invalid conditions value. Expected JSON array or array of condition objects.`
    )
    return { value, warnings, diagnostics }
  }

  const objectItems = items
    .map((item) => {
      if (typeof item === 'string') {
        return {
          id: crypto.randomUUID(),
          title: '',
          value: item,
        }
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null
      }
      const itemRecord = item as Record<string, unknown>
      const idCandidate = String(itemRecord.id || '').trim()
      const titleCandidate = itemRecord.title ?? itemRecord.label ?? itemRecord.name
      const valueCandidate =
        itemRecord.value ?? itemRecord.condition ?? itemRecord.expression ?? itemRecord.when ?? ''
      return {
        id: idCandidate || crypto.randomUUID(),
        title: typeof titleCandidate === 'string' ? titleCandidate : '',
        value: typeof valueCandidate === 'string' ? valueCandidate : String(valueCandidate ?? ''),
      }
    })
    .filter((item): item is { id: string; title: string; value: string } => Boolean(item))

  if (objectItems.length === 0) {
    diagnostics.push(`${operationName} on ${targetId} has no valid condition entries`)
    return { value, warnings, diagnostics }
  }

  const normalized = objectItems.map((item, index) => {
    const titleNormalization = normalizeConditionTitleForPosition({
      rawTitle: item.title,
      index,
      total: objectItems.length,
    })
    let normalizedValue = String(item.value || '')
    if (titleNormalization.overwritten) {
      warnings.push(
        `${operationName} on ${targetId} normalized condition title "${titleNormalization.rawTitleText}" to "${titleNormalization.title}" at index ${index}`
      )
    }
    if (titleNormalization.title === 'else' && normalizedValue.trim().length > 0) {
      warnings.push(
        `${operationName} on ${targetId} ignored expression on "else" branch at index ${index}; else branch does not evaluate a condition`
      )
      normalizedValue = ''
    }
    return {
      id: String(item.id || '').trim() || crypto.randomUUID(),
      title: titleNormalization.title,
      value: normalizedValue,
    }
  })

  return {
    value: normalized,
    warnings,
    diagnostics,
  }
}

function normalizeRouterRoutesInputValue(params: {
  value: unknown
  targetId: string
  operationName: 'patch_block' | 'ensure_block'
}): {
  value: Array<{ id: string; title: string; value: string }> | unknown
  warnings: string[]
  diagnostics: string[]
} {
  const { value, targetId, operationName } = params
  const warnings: string[] = []
  const diagnostics: string[] = []
  const parsed = parseArrayLikeInput(value)
  let items = parsed.items

  if (!items && typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      items = [{ title: 'route-1', value: trimmed }]
      warnings.push(
        `${operationName} on ${targetId} received non-JSON routes string; treated as a single route description`
      )
    }
  }

  if (!items) {
    diagnostics.push(
      `${operationName} on ${targetId} has invalid routes value. Expected JSON array or array of route objects.`
    )
    return { value, warnings, diagnostics }
  }

  const normalized = items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: crypto.randomUUID(),
          title: `route-${index + 1}`,
          value: item,
        }
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null
      }
      const itemRecord = item as Record<string, unknown>
      const idCandidate =
        String(itemRecord.id || itemRecord.routeId || itemRecord.key || '').trim() ||
        crypto.randomUUID()
      const titleCandidate =
        String(itemRecord.title || itemRecord.name || itemRecord.label || '').trim() ||
        `route-${index + 1}`
      const valueCandidate =
        itemRecord.value ??
        itemRecord.description ??
        itemRecord.condition ??
        itemRecord.expression ??
        itemRecord.prompt ??
        ''
      return {
        id: idCandidate,
        title: titleCandidate,
        value: typeof valueCandidate === 'string' ? valueCandidate : String(valueCandidate ?? ''),
      }
    })
    .filter((item): item is { id: string; title: string; value: string } => Boolean(item))

  if (normalized.length === 0) {
    diagnostics.push(`${operationName} on ${targetId} has no valid route entries`)
    return { value, warnings, diagnostics }
  }

  return {
    value: normalized,
    warnings,
    diagnostics,
  }
}

type ReferenceValidationContext = {
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
  blockMetaById: Record<string, { type: string; triggerMode: boolean }>
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
  const blockMetaById: Record<string, { type: string; triggerMode: boolean }> = {}

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

    const blockRecord = block as Record<string, unknown>
    blockMetaById[blockId] = {
      type: String(blockRecord.type || ''),
      triggerMode: blockRecord.triggerMode === true,
    }
  }

  return {
    blockNameMapping,
    blockOutputSchemas,
    blockMetaById,
  }
}

function extractAngleReferenceCandidates(value: string): Array<{ raw: string; likely: boolean }> {
  const seen = new Set<string>()
  const candidates: Array<{ raw: string; likely: boolean }> = []
  const pattern = createReferencePattern()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const raw = String(match[0] || '').trim()
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    candidates.push({
      raw,
      likely: isLikelyReferenceSegment(raw),
    })
  }
  return candidates
}

function extractEnvVarCandidates(value: string): Array<{ raw: string; key: string }> {
  const seen = new Set<string>()
  const candidates: Array<{ raw: string; key: string }> = []
  const pattern = createEnvVarPattern()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const raw = String(match[0] || '').trim()
    const key = String(match[1] || '').trim()
    if (!raw) continue
    const dedupeKey = `${raw}::${key}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    candidates.push({ raw, key })
  }
  return candidates
}

function isReferenceIntentSegment(reference: string): boolean {
  if (!reference.startsWith(REFERENCE.START) || !reference.endsWith(REFERENCE.END)) {
    return false
  }
  const inner = reference.slice(REFERENCE.START.length, -REFERENCE.END.length).trim()
  if (!inner) return false
  if (/\s/.test(inner)) return false
  if (!/[A-Za-z_]/.test(inner)) return false
  if (/^[<>=!+\-*/%&|^()0-9.]+$/.test(inner)) return false
  return true
}

function validateEnvVarReference(params: {
  raw: string
  key: string
  knownEnvVarNames: Set<string>
}): string | null {
  const { raw, key, knownEnvVarNames } = params
  const trimmedKey = key.trim()
  if (!trimmedKey) {
    return `environment reference "${raw}" is empty`
  }

  const looksLikeWorkflowRef = /^[A-Za-z0-9_-]+\.[^\s{}<>]+$/.test(trimmedKey)
  if (looksLikeWorkflowRef) {
    return (
      `environment reference "${raw}" looks like a workflow variable reference. ` +
      `Use "<${trimmedKey}>" for workflow outputs and reserve "{{...}}" for environment variables.`
    )
  }

  if (knownEnvVarNames.size > 0 && !knownEnvVarNames.has(trimmedKey)) {
    return (
      `environment reference "${raw}" does not match a known environment variable. ` +
      `Known vars are provided by get_credentials.environment.variableNames.`
    )
  }

  return null
}

function validateInvalidAngleReferenceIntent(reference: string): string | null {
  if (!isReferenceIntentSegment(reference)) return null

  const inner = reference.slice(REFERENCE.START.length, -REFERENCE.END.length).trim()
  const [head, ...tail] = inner.split(REFERENCE.PATH_DELIMITER)
  if (!head) {
    return `reference "${reference}" has invalid syntax`
  }

  const suggestedHead = head.replace(/[_-]+/g, '')
  if (suggestedHead && suggestedHead !== head) {
    const suggestedPath = [suggestedHead, ...tail].join(REFERENCE.PATH_DELIMITER)
    return (
      `reference "${reference}" is not valid. ` +
      `If this is a workflow variable, prefer normalized form "<${suggestedPath}>".`
    )
  }

  return (
    `reference "${reference}" appears to be a workflow variable reference but is not valid. ` +
    `Use "<block.field>" (or "<start.input>", "<loop.item>", "<parallel.currentItem>").`
  )
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

  const sourceBlockId = context.blockNameMapping[normalizeName(head)]
  const sourceBlockMeta = sourceBlockId ? context.blockMetaById[sourceBlockId] : undefined

  // Keep variable/loop/parallel references warning-free at compile time because
  // they can be context-dependent and <...> may also be used for non-variable text.
  if (
    head === REFERENCE.PREFIX.VARIABLE ||
    head === REFERENCE.PREFIX.LOOP ||
    head === REFERENCE.PREFIX.PARALLEL
  ) {
    return null
  }

  // Trigger outputs are often runtime-shaped and can include provider-specific payloads
  // that are not fully represented in static schemas. Do not emit field warnings here.
  if (sourceBlockMeta?.triggerMode) {
    return null
  }

  try {
    const result = resolveBlockReference(head, pathParts, {
      blockNameMapping: context.blockNameMapping,
      blockData: {},
      blockOutputSchemas: context.blockOutputSchemas,
    })
    if (!result) {
      const suggestedHead = head.replace(/[_-]+/g, '')
      const hasSuggestedBlock =
        suggestedHead &&
        suggestedHead !== head &&
        Boolean(context.blockNameMapping[normalizeName(suggestedHead)])
      if (hasSuggestedBlock) {
        const suggestedReference = [suggestedHead, ...pathParts]
          .filter(Boolean)
          .join(REFERENCE.PATH_DELIMITER)
        return (
          `reference "${trimmed}" points to unknown block "${head}". ` +
          `Try normalized block reference "<${suggestedReference}>".`
        )
      }
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

function buildReferenceToken(head: string, pathParts: string[]): string {
  const joinedPath = [head, ...pathParts].filter(Boolean).join(REFERENCE.PATH_DELIMITER)
  return `${REFERENCE.START}${joinedPath}${REFERENCE.END}`
}

function getNormalizedReferenceHeadCandidates(head: string): string[] {
  const candidates = [head]
  const collapsed = head.replace(/[_-]+/g, '')
  if (collapsed && collapsed !== head) {
    candidates.push(collapsed)
  }
  return stableUnique(candidates)
}

function getNormalizedReferencePathCandidates(pathParts: string[]): string[][] {
  const candidates: string[][] = [pathParts]
  let current = [...pathParts]
  while (current.length > 1) {
    const first = normalizeAliasToken(current[0] || '')
    if (!REFERENCE_PATH_WRAPPER_SEGMENTS.has(first)) {
      break
    }
    current = current.slice(1)
    candidates.push(current)
  }
  return candidates
}

function normalizeSingleWorkflowReferenceToken(params: {
  reference: string
  context: ReferenceValidationContext
}): { normalized: string; warning?: string } {
  const { reference, context } = params
  const trimmed = reference.trim()
  const parsed = parseReferencePath(trimmed)
  if (parsed.length < 2) {
    return { normalized: trimmed }
  }

  const [head, ...pathParts] = parsed
  if (!head) {
    return { normalized: trimmed }
  }
  if (
    head === REFERENCE.PREFIX.VARIABLE ||
    head === REFERENCE.PREFIX.LOOP ||
    head === REFERENCE.PREFIX.PARALLEL
  ) {
    return { normalized: trimmed }
  }

  const originalValidationError = validateReference(trimmed, context)
  const originalIsValid = !originalValidationError
  const originalWrapperDepth = (() => {
    let depth = 0
    for (const segment of pathParts) {
      if (!REFERENCE_PATH_WRAPPER_SEGMENTS.has(normalizeAliasToken(segment || ''))) {
        break
      }
      depth += 1
    }
    return depth
  })()

  const candidateHeads = getNormalizedReferenceHeadCandidates(head)
  const candidatePaths = getNormalizedReferencePathCandidates(pathParts)
  const validCandidates = new Set<string>()
  if (originalIsValid) {
    validCandidates.add(trimmed)
  }

  for (const candidateHead of candidateHeads) {
    for (const candidatePath of candidatePaths) {
      const candidate = buildReferenceToken(candidateHead, candidatePath)
      if (!validateReference(candidate, context)) {
        validCandidates.add(candidate)
      }
    }
  }

  const scoreCandidate = (candidate: string): { wrapperDepth: number; pathLength: number } => {
    const parsedCandidate = parseReferencePath(candidate)
    const candidatePath = parsedCandidate.slice(1)
    let wrapperDepth = 0
    for (const segment of candidatePath) {
      if (!REFERENCE_PATH_WRAPPER_SEGMENTS.has(normalizeAliasToken(segment || ''))) {
        break
      }
      wrapperDepth += 1
    }
    return {
      wrapperDepth,
      pathLength: candidatePath.length,
    }
  }

  const orderedCandidates = [...validCandidates].sort((a, b) => {
    const scoreA = scoreCandidate(a)
    const scoreB = scoreCandidate(b)
    if (scoreA.wrapperDepth !== scoreB.wrapperDepth) {
      return scoreA.wrapperDepth - scoreB.wrapperDepth
    }
    if (scoreA.pathLength !== scoreB.pathLength) {
      return scoreA.pathLength - scoreB.pathLength
    }
    return a.localeCompare(b)
  })

  if (orderedCandidates.length > 0) {
    const preferred = orderedCandidates[0]
    if (originalIsValid && originalWrapperDepth === 0 && preferred === trimmed) {
      return { normalized: trimmed }
    }
    if (preferred !== trimmed) {
      return {
        normalized: preferred,
        warning: `normalized workflow reference "${trimmed}" to "${preferred}"`,
      }
    }
    return { normalized: preferred }
  }

  if (originalIsValid) {
    return { normalized: trimmed }
  }

  return { normalized: trimmed }
}

function normalizeReferenceSyntaxForString(params: {
  value: string
  context: ReferenceValidationContext
  knownEnvVarNames: Set<string>
}): { value: string; warnings: string[] } {
  const { context } = params
  let nextValue = params.value
  const warnings: string[] = []

  for (const candidate of extractAngleReferenceCandidates(nextValue)) {
    if (!candidate.likely) {
      continue
    }
    const normalized = normalizeSingleWorkflowReferenceToken({
      reference: candidate.raw,
      context,
    })
    if (normalized.normalized !== candidate.raw) {
      nextValue = nextValue.split(candidate.raw).join(normalized.normalized)
      warnings.push(
        normalized.warning ||
          `normalized workflow reference "${candidate.raw}" to "${normalized.normalized}"`
      )
    }
  }

  return {
    value: nextValue,
    warnings,
  }
}

function normalizeReferenceSyntaxForValue(params: {
  value: unknown
  context: ReferenceValidationContext
  knownEnvVarNames: Set<string>
}): { value: unknown; warnings: string[] } {
  const { value, context } = params

  if (typeof value === 'string') {
    return normalizeReferenceSyntaxForString({
      value,
      context,
      knownEnvVarNames: params.knownEnvVarNames,
    })
  }

  if (Array.isArray(value)) {
    const warnings: string[] = []
    const normalizedValues = value.map((item) => {
      const normalizedItem = normalizeReferenceSyntaxForValue({
        value: item,
        context,
        knownEnvVarNames: params.knownEnvVarNames,
      })
      warnings.push(...normalizedItem.warnings)
      return normalizedItem.value
    })
    return {
      value: normalizedValues,
      warnings,
    }
  }

  if (value && typeof value === 'object') {
    const warnings: string[] = []
    const normalizedObject: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedChild = normalizeReferenceSyntaxForValue({
        value: child,
        context,
        knownEnvVarNames: params.knownEnvVarNames,
      })
      normalizedObject[key] = normalizedChild.value
      warnings.push(...normalizedChild.warnings)
    }
    return {
      value: normalizedObject,
      warnings,
    }
  }

  return {
    value,
    warnings: [],
  }
}

function collectReferenceWarningsForValue(params: {
  value: unknown
  location: string
  context: ReferenceValidationContext
  knownEnvVarNames: Set<string>
  sink: Set<string>
}): void {
  const { value, location, context, knownEnvVarNames, sink } = params
  if (typeof value === 'string') {
    const angleCandidates = extractAngleReferenceCandidates(value)
    for (const candidate of angleCandidates) {
      const warning = candidate.likely
        ? validateReference(candidate.raw, context)
        : validateInvalidAngleReferenceIntent(candidate.raw)
      if (warning) {
        sink.add(`${location}: ${warning}`)
      }
    }

    const envVarCandidates = extractEnvVarCandidates(value)
    for (const candidate of envVarCandidates) {
      const warning = validateEnvVarReference({
        raw: candidate.raw,
        key: candidate.key,
        knownEnvVarNames,
      })
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
        knownEnvVarNames,
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
        knownEnvVarNames,
        sink,
      })
    }
  }
}

function collectReferenceWarningsForChangeSpec(params: {
  changeSpec: ChangeSpec
  workflowState: { blocks: Record<string, any> }
  knownEnvVarNames?: string[]
}): string[] {
  const { changeSpec, workflowState } = params
  const context = buildReferenceValidationContext(workflowState)
  const knownEnvVarNames = new Set(
    Array.isArray(params.knownEnvVarNames)
      ? params.knownEnvVarNames.map((name) => String(name || '').trim()).filter(Boolean)
      : []
  )
  const warnings = new Set<string>()

  for (const [mutationIndex, mutation] of (changeSpec.mutations || []).entries()) {
    if (mutation.action === 'ensure_block' || mutation.action === 'insert_into_subflow') {
      if (mutation.inputs) {
        collectReferenceWarningsForValue({
          value: mutation.inputs,
          location: `mutations[${mutationIndex}].inputs`,
          context,
          knownEnvVarNames,
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
          knownEnvVarNames,
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

function canonicalizeConditionHandleAlias(handle: string): {
  handle: string
  warning?: string
} {
  const trimmed = String(handle || '').trim()
  if (!trimmed) return { handle: 'if', warning: 'defaulted empty condition handle to "if"' }
  if (trimmed.startsWith('condition-')) {
    const suffix = trimmed.slice('condition-'.length).trim()
    if (UUID_REGEX.test(suffix)) {
      return { handle: trimmed }
    }
    const normalizedSuffix = normalizeAliasToken(suffix)
    if (normalizedSuffix === 'if' || normalizedSuffix === 'then' || normalizedSuffix === 'true') {
      return { handle: 'if', warning: `normalized condition handle "${trimmed}" to "if"` }
    }
    if (
      normalizedSuffix === 'else' ||
      normalizedSuffix === 'otherwise' ||
      normalizedSuffix === 'default'
    ) {
      return { handle: 'else', warning: `normalized condition handle "${trimmed}" to "else"` }
    }
    const elseIfMatch =
      suffix.match(/^else[\s_-]*if(?:[\s_-]*(\d+))?$/i) ||
      suffix.match(/^elseif(?:[\s_-]*(\d+))?$/i)
    if (elseIfMatch) {
      const rawIndex = elseIfMatch[1]
      const parsed = rawIndex ? Number.parseInt(rawIndex, 10) : 0
      const index = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
      return {
        handle: `else-if-${index}`,
        warning: `normalized condition handle "${trimmed}" to "else-if-${index}"`,
      }
    }
    return { handle: trimmed }
  }

  const normalized = normalizeAliasToken(trimmed)
  if (normalized === 'source' || normalized === 'success') {
    return {
      handle: 'if',
      warning: `normalized condition handle "${trimmed}" to "if"`,
    }
  }
  if (normalized === 'if' || normalized === 'true' || normalized === 'then') {
    return { handle: 'if' }
  }
  if (normalized === 'else' || normalized === 'otherwise' || normalized === 'default') {
    return { handle: 'else' }
  }

  const elseIfMatch =
    trimmed.match(/^else[\s_-]*if(?:[\s_-]*(\d+))?$/i) ||
    trimmed.match(/^elseif(?:[\s_-]*(\d+))?$/i)
  if (elseIfMatch) {
    const rawIndex = elseIfMatch[1]
    if (!rawIndex) {
      return { handle: 'else-if-0', warning: `normalized condition handle "${trimmed}" to "else-if-0"` }
    }
    const parsed = Number(rawIndex)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { handle: 'else-if-0', warning: `normalized condition handle "${trimmed}" to "else-if-0"` }
    }
    return { handle: `else-if-${parsed}` }
  }

  return { handle: trimmed }
}

function canonicalizeRouterHandleAlias(handle: string): {
  handle: string
  warning?: string
} {
  const trimmed = String(handle || '').trim()
  if (!trimmed) {
    return { handle: 'route-0', warning: 'defaulted empty router handle to "route-0"' }
  }
  if (trimmed.startsWith('router-')) return { handle: trimmed }

  const normalized = normalizeAliasToken(trimmed)
  if (normalized === 'source' || normalized === 'success' || normalized === 'route') {
    return {
      handle: 'route-0',
      warning: `normalized router handle "${trimmed}" to "route-0"`,
    }
  }

  const routeMatch = trimmed.match(/^route[\s_-]*(\d+)$/i)
  if (routeMatch) {
    const parsed = Number(routeMatch[1])
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { handle: 'route-0', warning: `normalized router handle "${trimmed}" to "route-0"` }
    }
    return { handle: `route-${parsed}` }
  }

  return { handle: trimmed }
}

function parseRouterRowsForCompile(
  routesValue: unknown
): Array<{ id: string; title: string }> {
  let rows: unknown[] | null = null
  if (Array.isArray(routesValue)) {
    rows = routesValue
  } else if (typeof routesValue === 'string') {
    try {
      const parsed = JSON.parse(routesValue)
      if (Array.isArray(parsed)) {
        rows = parsed
      }
    } catch {
      rows = null
    }
  }

  if (!rows) return []
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null
      const record = row as Record<string, unknown>
      return {
        id: String(record.id || '').trim(),
        title: String(record.title || record.name || record.label || '').trim(),
      }
    })
    .filter((row): row is { id: string; title: string } => Boolean(row))
}

function resolveRouterHandleAliasFromRoutes(params: {
  requestedHandle: string
  canonicalHandle: string
  routesValue: unknown
}): { handle: string; warning?: string } {
  const { requestedHandle, canonicalHandle, routesValue } = params
  if (canonicalHandle.startsWith('route-')) {
    return { handle: canonicalHandle }
  }

  const routeRows = parseRouterRowsForCompile(routesValue)
  if (routeRows.length === 0) {
    return { handle: canonicalHandle }
  }

  if (canonicalHandle.startsWith('router-')) {
    const suffix = canonicalHandle.slice('router-'.length).trim()
    const suffixToken = normalizeAliasToken(suffix)
    const idMatch = routeRows.find((route) => normalizeAliasToken(route.id) === suffixToken)
    if (idMatch) {
      return { handle: `router-${idMatch.id}` }
    }
    const routeIndexMatch = suffix.match(/^route[\s_-]*(\d+)$/i)
    if (routeIndexMatch) {
      const rawNumber = Number.parseInt(routeIndexMatch[1], 10)
      if (Number.isFinite(rawNumber)) {
        // Legacy router-route-N aliases are commonly 1-indexed in prompts.
        const zeroIndexed = Math.max(0, rawNumber - 1)
        if (zeroIndexed < routeRows.length) {
          return {
            handle: `route-${zeroIndexed}`,
            warning:
              `normalized router handle "${requestedHandle}" to "route-${zeroIndexed}" ` +
              `(from legacy "${canonicalHandle}")`,
          }
        }
      }
    }
  }

  const requestedToken = normalizeAliasToken(requestedHandle)
  const canonicalToken = normalizeAliasToken(canonicalHandle)
  const routerSuffixToken = canonicalHandle.startsWith('router-')
    ? normalizeAliasToken(canonicalHandle.slice('router-'.length))
    : ''
  const tokensToMatch = stableUnique(
    [requestedToken, canonicalToken, routerSuffixToken].filter(Boolean)
  )

  for (let index = 0; index < routeRows.length; index++) {
    const route = routeRows[index]
    const idToken = normalizeAliasToken(route.id)
    const titleToken = normalizeAliasToken(route.title)

    if (route.id && tokensToMatch.includes(idToken)) {
      return {
        handle: `router-${route.id}`,
        warning: `normalized router handle "${requestedHandle}" to route id "${route.id}"`,
      }
    }

    if (route.title && tokensToMatch.includes(titleToken)) {
      return {
        handle: `route-${index}`,
        warning:
          `normalized router handle "${requestedHandle}" to "route-${index}" ` +
          `using route title "${route.title}"`,
      }
    }
  }

  return { handle: canonicalHandle }
}

function parseConditionRowsForCompile(
  conditionsValue: unknown
): Array<{ id: string; title: string }> {
  const normalizedRows = normalizeConditionRowsForCompile(conditionsValue)
  if (!normalizedRows) return []
  return normalizedRows.map((row) => ({ id: row.id, title: row.title }))
}

function resolveConditionHandleAliasFromConditions(params: {
  requestedHandle: string
  canonicalHandle: string
  conditionsValue: unknown
}): { handle: string; warning?: string } {
  const { requestedHandle, canonicalHandle, conditionsValue } = params
  if (
    canonicalHandle === 'if' ||
    canonicalHandle === 'else' ||
    canonicalHandle.startsWith('else-if-')
  ) {
    return { handle: canonicalHandle }
  }

  const conditionRows = parseConditionRowsForCompile(conditionsValue)
  if (conditionRows.length === 0) {
    return { handle: canonicalHandle }
  }

  const parseConditionBranchAlias = (raw: string): string | null => {
    const trimmed = String(raw || '').trim()
    if (!trimmed) return null

    const normalized = normalizeAliasToken(trimmed)
    if (normalized === 'if' || normalized === 'then' || normalized === 'true') {
      return 'if'
    }
    if (normalized === 'else' || normalized === 'otherwise' || normalized === 'default') {
      return 'else'
    }

    const elseIfMatch =
      trimmed.match(/^else[\s_-]*if(?:[\s_-]*(\d+))?$/i) ||
      trimmed.match(/^elseif(?:[\s_-]*(\d+))?$/i)
    if (elseIfMatch) {
      const rawIndex = elseIfMatch[1]
      const index = rawIndex ? Number.parseInt(rawIndex, 10) : 0
      return Number.isFinite(index) && index >= 0 ? `else-if-${index}` : 'else-if-0'
    }

    const semanticTail = trimmed.match(/(?:^|[-_])(if|else|else[\s_-]*if(?:[\s_-]*\d+)?)$/i)
    if (semanticTail?.[1]) {
      return parseConditionBranchAlias(semanticTail[1])
    }

    return null
  }

  if (canonicalHandle.startsWith('condition-')) {
    const rawSuffix = canonicalHandle.slice('condition-'.length).trim()
    const suffixToken = normalizeAliasToken(rawSuffix)
    const idMatch = conditionRows.find((row) => normalizeAliasToken(row.id) === suffixToken)
    if (idMatch) {
      return { handle: `condition-${idMatch.id}` }
    }
    const branchAlias = parseConditionBranchAlias(rawSuffix)
    if (branchAlias) {
      return {
        handle: branchAlias,
        warning: `normalized condition handle "${requestedHandle}" to "${branchAlias}"`,
      }
    }
  }

  const requestedToken = normalizeAliasToken(requestedHandle)
  const canonicalToken = normalizeAliasToken(canonicalHandle)
  const tokensToMatch = stableUnique([requestedToken, canonicalToken].filter(Boolean))

  for (let index = 0; index < conditionRows.length; index++) {
    const row = conditionRows[index]
    const idToken = normalizeAliasToken(row.id)
    const titleToken = normalizeAliasToken(row.title)

    if (row.id && tokensToMatch.includes(idToken)) {
      return {
        handle: `condition-${row.id}`,
        warning: `normalized condition handle "${requestedHandle}" to condition id "${row.id}"`,
      }
    }

    if (tokensToMatch.includes(titleToken)) {
      if (row.title === 'if') return { handle: 'if' }
      if (row.title === 'else') return { handle: 'else' }
      return {
        handle: `else-if-${Math.max(0, index - 1)}`,
        warning:
          `normalized condition handle "${requestedHandle}" to "else-if-${Math.max(0, index - 1)}" ` +
          `using condition title "${row.title}"`,
      }
    }
  }

  return { handle: canonicalHandle }
}

function normalizeConditionRowsForCompile(
  value: unknown
): Array<{ id: string; title: 'if' | 'else if' | 'else'; value: string }> | null {
  const parsed = parseArrayLikeInput(value)
  if (!parsed.items) return null

  const rows = parsed.items
    .map((item) => {
      if (typeof item === 'string') {
        return {
          id: crypto.randomUUID(),
          title: '',
          value: item,
        }
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const titleCandidate = record.title ?? record.label ?? record.name
      const valueCandidate =
        record.value ?? record.condition ?? record.expression ?? record.when ?? ''
      return {
        id: String(record.id || '').trim() || crypto.randomUUID(),
        title: typeof titleCandidate === 'string' ? titleCandidate : '',
        value: typeof valueCandidate === 'string' ? valueCandidate : String(valueCandidate ?? ''),
      }
    })
    .filter((row): row is { id: string; title: string; value: string } => Boolean(row))

  if (rows.length === 0) return null

  return rows.map((row, index) => {
    const titleNormalization = normalizeConditionTitleForPosition({
      rawTitle: row.title,
      index,
      total: rows.length,
    })
    return {
      id: row.id,
      title: titleNormalization.title,
      value: titleNormalization.title === 'else' ? '' : String(row.value || ''),
    }
  })
}

function maybeAutoAddElseBranchForCondition(params: {
  sourceBlockId: string
  sourceBlock: Record<string, any> | undefined
  requestedHandle: string
}): {
  updatedValue?: Array<{ id: string; title: 'if' | 'else if' | 'else'; value: string }>
  warnings: string[]
} {
  const { sourceBlockId, sourceBlock, requestedHandle } = params
  if (requestedHandle !== 'else' || !sourceBlock) {
    return { warnings: [] }
  }

  const currentValue = sourceBlock?.subBlocks?.conditions?.value
  const normalizedRows = normalizeConditionRowsForCompile(currentValue)
  if (!normalizedRows || normalizedRows.length === 0) {
    return { warnings: [] }
  }

  const hasElse = normalizedRows.some((row) => row.title === 'else')
  if (hasElse) {
    return { warnings: [] }
  }

  const nextRows = [
    ...normalizedRows.map((row, index) => ({
      ...row,
      title: (index === 0 ? 'if' : 'else if') as 'if' | 'else if' | 'else',
      value: row.value,
    })),
    { id: crypto.randomUUID(), title: 'else' as const, value: '' },
  ]

  if (!sourceBlock.subBlocks) {
    sourceBlock.subBlocks = {}
  }
  const existingConditionsSubBlock =
    sourceBlock.subBlocks.conditions && typeof sourceBlock.subBlocks.conditions === 'object'
      ? sourceBlock.subBlocks.conditions
      : { id: 'conditions', type: 'condition-input' }
  sourceBlock.subBlocks.conditions = {
    ...existingConditionsSubBlock,
    id: 'conditions',
    value: nextRows,
  }

  return {
    updatedValue: nextRows,
    warnings: [
      `Condition block "${sourceBlockId}" auto-added an "else" row because a connection used handle "else".`,
    ],
  }
}

function normalizeBranchingSourceHandleForCompile(params: {
  sourceBlockId: string
  sourceBlockType: string
  sourceHandle: string
  sourceBlock: Record<string, any> | undefined
}): {
  sourceHandle: string
  warnings: string[]
  diagnostic?: string
  inputPatch?: { field: string; value: unknown }
} {
  const { sourceBlockId, sourceBlockType, sourceHandle, sourceBlock } = params
  const warnings: string[] = []

  if (sourceBlockType === 'condition') {
    const canonicalized = canonicalizeConditionHandleAlias(sourceHandle)
    if (canonicalized.warning) warnings.push(canonicalized.warning)
    const autoElse = maybeAutoAddElseBranchForCondition({
      sourceBlockId,
      sourceBlock,
      requestedHandle: canonicalized.handle,
    })
    warnings.push(...autoElse.warnings)

    let conditionValue = sourceBlock?.subBlocks?.conditions?.value
    if (autoElse.updatedValue) {
      conditionValue = autoElse.updatedValue
    }
    if (!conditionValue) {
      return {
        sourceHandle: canonicalized.handle,
        warnings,
        diagnostic:
          `Condition block "${sourceBlockId}" has no conditions configured. ` +
          `Set inputs.conditions before connecting branches.`,
      }
    }
    const resolvedAlias = resolveConditionHandleAliasFromConditions({
      requestedHandle: sourceHandle,
      canonicalHandle: canonicalized.handle,
      conditionsValue: conditionValue,
    })
    if (resolvedAlias.warning) warnings.push(resolvedAlias.warning)

    const handleForValidation = resolvedAlias.handle
    const validation = validateConditionHandle(handleForValidation, sourceBlockId, conditionValue)
    if (!validation.valid) {
      return {
        sourceHandle: handleForValidation,
        warnings,
        diagnostic:
          `Invalid condition branch handle "${sourceHandle}" for block "${sourceBlockId}": ` +
          `${validation.error}`,
      }
    }
    return {
      sourceHandle: validation.normalizedHandle || handleForValidation,
      warnings,
      inputPatch: autoElse.updatedValue
        ? {
            field: 'conditions',
            value: autoElse.updatedValue,
          }
        : undefined,
    }
  }

  if (sourceBlockType === 'router_v2') {
    const canonicalized = canonicalizeRouterHandleAlias(sourceHandle)
    if (canonicalized.warning) warnings.push(canonicalized.warning)
    const routesValue = sourceBlock?.subBlocks?.routes?.value
    if (!routesValue) {
      return {
        sourceHandle: canonicalized.handle,
        warnings,
        diagnostic:
          `Router block "${sourceBlockId}" has no routes configured. ` +
          `Set inputs.routes before connecting route branches.`,
      }
    }
    const resolvedAlias = resolveRouterHandleAliasFromRoutes({
      requestedHandle: sourceHandle,
      canonicalHandle: canonicalized.handle,
      routesValue,
    })
    if (resolvedAlias.warning) warnings.push(resolvedAlias.warning)

    const handleForValidation = resolvedAlias.handle
    const validation = validateRouterHandle(handleForValidation, sourceBlockId, routesValue)
    if (!validation.valid) {
      return {
        sourceHandle: handleForValidation,
        warnings,
        diagnostic:
          `Invalid router branch handle "${sourceHandle}" for block "${sourceBlockId}": ` +
          `${validation.error}`,
      }
    }
    return {
      sourceHandle: validation.normalizedHandle || handleForValidation,
      warnings,
    }
  }

  if (sourceBlockType === 'router') {
    const canonicalized = canonicalizeRouterHandleAlias(sourceHandle)
    if (canonicalized.warning) warnings.push(canonicalized.warning)
    // Legacy router does not use route definitions in inputs; keep deterministic by
    // normalizing ambiguous route aliases to "source".
    if (canonicalized.handle.startsWith('route-')) {
      return {
        sourceHandle: 'source',
        warnings: [
          ...warnings,
          `normalized legacy router handle "${sourceHandle}" to "source"`,
        ],
      }
    }
    return {
      sourceHandle: canonicalized.handle,
      warnings,
    }
  }

  return { sourceHandle, warnings }
}

function expectedContainerTypeForSourceHandle(
  handle: string | undefined
): 'loop' | 'parallel' | null {
  if (!handle) return null
  return CONTAINER_SOURCE_HANDLE_EXPECTED_TYPE[handle] || null
}

function normalizeContainerConnectionHandles(params: {
  fromBlockId: string
  toBlockId: string
  sourceHandle: string
  targetHandle: string
  sourceBlockType: string
  targetBlockType: string
  sourceParentId: string | null
  targetParentId: string | null
}): { sourceHandle: string; targetHandle: string; warnings: string[] } {
  const {
    fromBlockId,
    toBlockId,
    sourceHandle,
    targetHandle,
    sourceBlockType,
    targetBlockType,
    sourceParentId,
    targetParentId,
  } = params

  let nextSourceHandle = sourceHandle
  let nextTargetHandle = targetHandle
  const warnings: string[] = []

  const inferContainerSourceHandle = (
    blockType: 'loop' | 'parallel',
    isTargetInsideContainer: boolean
  ): string =>
    blockType === 'loop'
      ? isTargetInsideContainer
        ? 'loop-start-source'
        : 'loop-end-source'
      : isTargetInsideContainer
        ? 'parallel-start-source'
        : 'parallel-end-source'

  const mapContainerHandleForType = (
    handle: string,
    blockType: 'loop' | 'parallel'
  ): string | null => {
    if (handle.endsWith('start-source')) {
      return blockType === 'loop' ? 'loop-start-source' : 'parallel-start-source'
    }
    if (handle.endsWith('end-source')) {
      return blockType === 'loop' ? 'loop-end-source' : 'parallel-end-source'
    }
    return null
  }

  if ((sourceBlockType === 'loop' || sourceBlockType === 'parallel') && nextSourceHandle === 'source') {
    const inferred = inferContainerSourceHandle(
      sourceBlockType,
      targetParentId === fromBlockId
    )
    nextSourceHandle = inferred
    warnings.push(
      `normalized source handle "source" to "${inferred}" for ${fromBlockId}->${toBlockId} based on container boundary`
    )
  }

  const sourceHandleContainerType = expectedContainerTypeForSourceHandle(nextSourceHandle)
  if (
    sourceHandleContainerType &&
    (sourceBlockType === 'loop' || sourceBlockType === 'parallel') &&
    sourceHandleContainerType !== sourceBlockType
  ) {
    const remapped = mapContainerHandleForType(nextSourceHandle, sourceBlockType)
    if (remapped && remapped !== nextSourceHandle) {
      warnings.push(
        `normalized source handle "${nextSourceHandle}" to "${remapped}" for ${fromBlockId} (${sourceBlockType})`
      )
      nextSourceHandle = remapped
    }
  }

  const normalizedSourceHandleContainerType = expectedContainerTypeForSourceHandle(nextSourceHandle)
  if (normalizedSourceHandleContainerType && sourceBlockType !== normalizedSourceHandleContainerType) {
    if (targetBlockType === normalizedSourceHandleContainerType) {
      const originalSourceHandle = nextSourceHandle
      nextSourceHandle = 'source'
      warnings.push(
        `normalized source handle "${originalSourceHandle}" to "source" for ${fromBlockId}->${toBlockId}. ` +
          `Container source handles belong on the container block as the "from" endpoint.`
      )
    }
  }

  const targetHandleContainerType = expectedContainerTypeForSourceHandle(targetHandle)
  if (
    targetHandleContainerType &&
    targetBlockType === targetHandleContainerType &&
    sourceBlockType !== targetHandleContainerType
  ) {
    const isStartHandle = targetHandle.endsWith('start-source')
    const isEndHandle = targetHandle.endsWith('end-source')

    if (isStartHandle) {
      nextTargetHandle = 'target'
      warnings.push(
        `normalized target handle "${targetHandle}" to "target" for ${fromBlockId}->${toBlockId}. ` +
          `Container start handles belong on the container as source handles.`
      )
    } else if (isEndHandle && sourceParentId === toBlockId) {
      nextTargetHandle = 'target'
      warnings.push(
        `normalized target handle "${targetHandle}" to "target" for ${fromBlockId}->${toBlockId}. ` +
          `Child blocks do not connect to container end handles directly.`
      )
    }
  }

  if (targetHandleContainerType && targetBlockType !== targetHandleContainerType) {
    if (sourceBlockType === targetHandleContainerType) {
      nextTargetHandle = 'target'
      warnings.push(
        `normalized target handle "${targetHandle}" to "target" for ${fromBlockId}->${toBlockId}. ` +
          `Container source handles belong on the container block as the "from" endpoint.`
      )
    }
  }

  return {
    sourceHandle: nextSourceHandle,
    targetHandle: nextTargetHandle,
    warnings,
  }
}

function hasIncomingConnection(connectionState: ConnectionState, targetId: string): boolean {
  for (const sourceMap of connectionState.values()) {
    for (const targets of sourceMap.values()) {
      if (targets.some((target) => target.block === targetId)) {
        return true
      }
    }
  }
  return false
}

function formatCyclePathForDiagnostics(params: {
  cyclePath: string[]
  workflowState: { blocks: Record<string, any> }
}): string {
  const { cyclePath, workflowState } = params
  if (!Array.isArray(cyclePath) || cyclePath.length === 0) {
    return 'unknown'
  }
  return cyclePath
    .map((blockId) => {
      const blockName = String(workflowState.blocks?.[blockId]?.name || '').trim()
      return blockName ? `${blockName} (${blockId})` : blockId
    })
    .join(' -> ')
}

function isTriggerLikeBlockType(blockType: string): boolean {
  if (!blockType) return false
  const blockConfig = getBlock(blockType)
  if (blockConfig?.category === 'triggers') {
    return true
  }
  return (
    blockType === 'start_trigger' ||
    blockType === 'starter' ||
    blockType.endsWith('_trigger')
  )
}

function collectUnusedIncomingPortWarnings(workflowState: {
  blocks: Record<string, any>
  edges: Array<Record<string, any>>
}): string[] {
  const incomingCounts = new Map<string, number>()
  for (const edge of workflowState.edges || []) {
    const targetId = String(edge?.target || '').trim()
    if (!targetId) continue
    incomingCounts.set(targetId, (incomingCounts.get(targetId) || 0) + 1)
  }

  const warnings: string[] = []
  for (const [blockId, rawBlock] of Object.entries(workflowState.blocks || {})) {
    const block = rawBlock as Record<string, any>
    const blockType = String(block?.type || '').trim()
    if (!blockType) continue
    if (block?.enabled === false) continue
    if (isAnnotationOnlyBlock(blockType)) continue
    if (isTriggerLikeBlockType(blockType)) continue

    const incomingCount = incomingCounts.get(blockId) || 0
    if (incomingCount > 0) continue

    const blockName = String(block?.name || '').trim() || blockId
    warnings.push(
      `Block "${blockName}" (${blockId}) has an unused incoming target port (no incoming connection).`
    )
  }

  return warnings
}

function addSubflowWiringWarnings(params: {
  workflowState: { blocks: Record<string, any> }
  connectionState: ConnectionState
  subflowIds: Set<string>
  warnings: string[]
}): void {
  const { workflowState, connectionState, subflowIds, warnings } = params
  for (const subflowId of stableUnique([...subflowIds])) {
    const subflowType = String(workflowState.blocks[subflowId]?.type || '')
    if (!isContainerBlockType(subflowType)) continue

    const childBlockIds = Object.entries(workflowState.blocks || {})
      .filter(([, block]) => String((block as Record<string, any>)?.data?.parentId || '') === subflowId)
      .map(([blockId]) => blockId)
    if (childBlockIds.length === 0) continue

    const startHandle = subflowType === 'loop' ? 'loop-start-source' : 'parallel-start-source'
    const startTargets = connectionState.get(subflowId)?.get(startHandle) || []
    if (startTargets.length === 0) {
      warnings.push(
        `Subflow "${subflowId}" has children but no "${startHandle}" connection. ` +
          `insert_into_subflow only sets containment; add connect/link mutations for execution wiring.`
      )
      continue
    }

    if (!startTargets.some((target) => childBlockIds.includes(target.block))) {
      warnings.push(
        `Subflow "${subflowId}" "${startHandle}" is not connected to any child block. ` +
          `Connect it to a child (for example first block in the subflow).`
      )
    }

    const orphanChildren = childBlockIds.filter((childBlockId) => {
      const reachedByStart = startTargets.some((target) => target.block === childBlockId)
      if (reachedByStart) return false
      return !hasIncomingConnection(connectionState, childBlockId)
    })

    if (orphanChildren.length > 0) {
      const preview = orphanChildren.slice(0, 4).join(', ')
      const suffix = orphanChildren.length > 4 ? ', ...' : ''
      warnings.push(
        `Subflow "${subflowId}" has child block(s) without incoming wiring: ${preview}${suffix}. ` +
          `Add connect/link mutations between child blocks.`
      )
    }
  }
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
  const touchedSubflowIds = new Set<string>()
  const resolvedIds: Record<string, string> = { ...(changeSpec.resolvedIds || {}) }
  const deferredConnectionMutations: Array<{ mutation: any; mutationIndex: number }> = []

  const aliasMap = new Map<string, string>()
  const workingState = deepClone(workflowState)
  const connectionState = buildConnectionState(workingState)
  const connectionTouchedSources = new Set<string>()
  const connectionInputPatches = new Map<string, Record<string, unknown>>()
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

  const normalizeContainerInputsForCompile = (params: {
    targetId: string
    blockType: string
    operationName: 'patch_block' | 'ensure_block'
    inputs: Record<string, any>
  }): Record<string, any> => {
    const { targetId, blockType, operationName, inputs } = params
    if (!isContainerBlockType(blockType)) {
      return inputs
    }

    const normalized: Record<string, any> = {}
    let sawWhileConditionAlias = false
    let sawDoWhileConditionAlias = false

    for (const [rawKey, rawValue] of Object.entries(inputs || {})) {
      const rawToken = normalizeAliasToken(rawKey)
      if (rawToken === 'whilecondition') sawWhileConditionAlias = true
      if (rawToken === 'dowhilecondition') sawDoWhileConditionAlias = true

      const canonicalKey = canonicalizeContainerInputKey(blockType, rawKey)
      if (canonicalKey !== rawKey) {
        warnings.push(
          `${operationName} on ${targetId} normalized container input key "${rawKey}" to "${canonicalKey}" for ${blockType}`
        )
      }
      normalized[canonicalKey] = rawValue
    }

    if (blockType === 'loop') {
      if (
        Object.prototype.hasOwnProperty.call(normalized, 'count') &&
        !Object.prototype.hasOwnProperty.call(normalized, 'iterations')
      ) {
        normalized.iterations = normalized.count
        delete normalized.count
        warnings.push(
          `${operationName} on ${targetId} normalized loop input "count" to "iterations"`
        )
      }

      const existingLoopType = canonicalizeLoopMode(workingState.blocks[targetId]?.data?.loopType)
      let explicitLoopType: 'for' | 'forEach' | 'while' | 'doWhile' | null = null
      if (Object.prototype.hasOwnProperty.call(normalized, 'loopType')) {
        explicitLoopType = canonicalizeLoopMode(normalized.loopType)
        if (!explicitLoopType) {
          diagnostics.push(
            `${operationName} on ${targetId} has invalid loopType "${String(normalized.loopType)}". ` +
              `Valid values: for, forEach, while, doWhile`
          )
          delete normalized.loopType
        } else if (normalized.loopType !== explicitLoopType) {
          warnings.push(
            `${operationName} on ${targetId} normalized loopType "${String(normalized.loopType)}" to "${explicitLoopType}"`
          )
          normalized.loopType = explicitLoopType
        } else {
          normalized.loopType = explicitLoopType
        }
      }

      if (!explicitLoopType) {
        let inferredLoopType: 'for' | 'forEach' | 'while' | 'doWhile' | null = null
        if (sawDoWhileConditionAlias) {
          inferredLoopType = 'doWhile'
        } else if (sawWhileConditionAlias) {
          inferredLoopType = 'while'
        } else if (Object.prototype.hasOwnProperty.call(normalized, 'condition')) {
          inferredLoopType =
            existingLoopType === 'while' || existingLoopType === 'doWhile'
              ? existingLoopType
              : 'while'
        } else if (Object.prototype.hasOwnProperty.call(normalized, 'collection')) {
          inferredLoopType = 'forEach'
        } else if (Object.prototype.hasOwnProperty.call(normalized, 'iterations')) {
          inferredLoopType = 'for'
        }

        if (inferredLoopType) {
          normalized.loopType = inferredLoopType
          warnings.push(
            `${operationName} on ${targetId} inferred loopType "${inferredLoopType}" from provided loop fields`
          )
        }
      }

      const finalLoopType = canonicalizeLoopMode(normalized.loopType) || existingLoopType || 'for'
      if (
        Object.prototype.hasOwnProperty.call(normalized, 'condition') &&
        finalLoopType !== 'while' &&
        finalLoopType !== 'doWhile'
      ) {
        warnings.push(
          `${operationName} on ${targetId} set "condition" but loopType is "${finalLoopType}". ` +
            `Condition is only used for while/doWhile loops.`
        )
      }
      if (
        Object.prototype.hasOwnProperty.call(normalized, 'collection') &&
        finalLoopType !== 'forEach'
      ) {
        warnings.push(
          `${operationName} on ${targetId} set "collection" but loopType is "${finalLoopType}". ` +
            `Collection is only used for forEach loops.`
        )
      }
      if (
        Object.prototype.hasOwnProperty.call(normalized, 'iterations') &&
        finalLoopType !== 'for'
      ) {
        warnings.push(
          `${operationName} on ${targetId} set "iterations" but loopType is "${finalLoopType}". ` +
            `Iterations is only used for for loops.`
        )
      }
    }

    if (blockType === 'parallel') {
      let explicitParallelType: 'count' | 'collection' | null = null
      if (Object.prototype.hasOwnProperty.call(normalized, 'parallelType')) {
        explicitParallelType = canonicalizeParallelMode(normalized.parallelType)
        if (!explicitParallelType) {
          diagnostics.push(
            `${operationName} on ${targetId} has invalid parallelType "${String(normalized.parallelType)}". ` +
              `Valid values: count, collection`
          )
          delete normalized.parallelType
        } else if (normalized.parallelType !== explicitParallelType) {
          warnings.push(
            `${operationName} on ${targetId} normalized parallelType "${String(normalized.parallelType)}" to "${explicitParallelType}"`
          )
          normalized.parallelType = explicitParallelType
        } else {
          normalized.parallelType = explicitParallelType
        }
      }

      if (!explicitParallelType) {
        if (Object.prototype.hasOwnProperty.call(normalized, 'collection')) {
          normalized.parallelType = 'collection'
          warnings.push(
            `${operationName} on ${targetId} inferred parallelType "collection" from provided collection`
          )
        } else if (Object.prototype.hasOwnProperty.call(normalized, 'count')) {
          normalized.parallelType = 'count'
          warnings.push(
            `${operationName} on ${targetId} inferred parallelType "count" from provided count`
          )
        }
      }
    }

    return normalized
  }

  const normalizeContainerPatchPathSegments = (
    targetId: string,
    blockType: string,
    pathSegments: string[]
  ): string[] => {
    if (!isContainerBlockType(blockType) || pathSegments.length === 0) {
      return pathSegments
    }

    const normalized = [...pathSegments]
    if (normalized[0] === 'data' && normalized[1]) {
      const originalPath = normalized.join('.')
      normalized[0] = 'inputs'
      warnings.push(
        `patch_block on ${targetId} normalized container path "${originalPath}" to "${normalized.join('.')}" for ${blockType}`
      )
    }

    if (normalized[0] !== 'inputs' && normalized.length === 1 && normalized[0] !== 'type') {
      const canonicalTopLevel = canonicalizeContainerInputKey(blockType, normalized[0])
      if (
        canonicalTopLevel &&
        (canonicalTopLevel !== normalized[0] ||
          (CONTAINER_INPUT_FIELDS[blockType] || []).includes(canonicalTopLevel))
      ) {
        const originalPath = normalized.join('.')
        normalized[0] = 'inputs'
        normalized[1] = canonicalTopLevel
        warnings.push(
          `patch_block on ${targetId} normalized container path "${originalPath}" to "${normalized.join('.')}" for ${blockType}`
        )
      }
    }

    if (normalized[0] === 'inputs' && normalized[1]) {
      const canonicalInput = canonicalizeContainerInputKey(blockType, normalized[1])
      if (canonicalInput !== normalized[1]) {
        const originalPath = normalized.join('.')
        normalized[1] = canonicalInput
        warnings.push(
          `patch_block on ${targetId} normalized container input path "${originalPath}" to "${normalized.join('.')}" for ${blockType}`
        )
      }
    }

    return normalized
  }

  const normalizeBranchingInputsForCompile = (params: {
    targetId: string
    blockType: string
    operationName: 'patch_block' | 'ensure_block'
    inputs: Record<string, any>
  }): Record<string, any> => {
    const { targetId, blockType, operationName } = params
    const normalizedInputs: Record<string, any> = { ...(params.inputs || {}) }

    if (blockType === 'condition' && Object.prototype.hasOwnProperty.call(normalizedInputs, 'conditions')) {
      const normalizedConditions = normalizeConditionInputValue({
        value: normalizedInputs.conditions,
        targetId,
        operationName,
      })
      warnings.push(...normalizedConditions.warnings)
      diagnostics.push(...normalizedConditions.diagnostics)
      normalizedInputs.conditions = normalizedConditions.value
    }

    if (blockType === 'router_v2' && Object.prototype.hasOwnProperty.call(normalizedInputs, 'routes')) {
      const normalizedRoutes = normalizeRouterRoutesInputValue({
        value: normalizedInputs.routes,
        targetId,
        operationName,
      })
      warnings.push(...normalizedRoutes.warnings)
      diagnostics.push(...normalizedRoutes.diagnostics)
      normalizedInputs.routes = normalizedRoutes.value
    }

    return normalizedInputs
  }

  const normalizeInputsWithSchema = (
    targetId: string,
    blockType: string,
    inputs: Record<string, any>,
    operationName: 'patch_block' | 'ensure_block'
  ): Record<string, any> => {
    const normalizedContainerInputs = normalizeContainerInputsForCompile({
      targetId,
      blockType,
      operationName,
      inputs,
    })
    const normalizedBranchingInputs = normalizeBranchingInputsForCompile({
      targetId,
      blockType,
      operationName,
      inputs: normalizedContainerInputs,
    })
    if (!requireSchema(targetId, blockType, operationName)) {
      return {}
    }
    const validation = validateInputsForBlock(blockType, normalizedBranchingInputs, targetId)
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
  const knownEnvVarNames: string[] =
    credentialsResponse?.environment?.variableNames?.map((name: any) => String(name || '').trim())?.filter(Boolean) ||
    []
  const knownEnvVarNamesSet = new Set(knownEnvVarNames)

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

  const resolveBlockType = (blockId: string): string =>
    String(workingState.blocks[blockId]?.type || plannedBlockTypes.get(blockId) || '')

  const resolveParentId = (blockId: string): string | null => {
    const parentId = String(workingState.blocks[blockId]?.data?.parentId || '').trim()
    return parentId.length > 0 ? parentId : null
  }

  const applyConnectionMutation = (mutation: any): void => {
    const from = resolveTarget(mutation.from)
    const to = resolveTarget(mutation.to)
    if (!from || !to) {
      diagnostics.push(
        `${mutation.action} requires resolvable from/to targets. Prefer alias/match selectors, ` +
          'or refresh workflow_context_get after prior apply before retrying.'
      )
      return
    }
    const sourceBlockType = resolveBlockType(from)
    const targetBlockType = resolveBlockType(to)
    const sourceParentId = resolveParentId(from)
    const normalizedBranchHandle = normalizeBranchingSourceHandleForCompile({
      sourceBlockId: from,
      sourceBlockType,
      sourceHandle: normalizeHandle(mutation.handle),
      sourceBlock: workingState.blocks[from],
    })
    warnings.push(
      ...normalizedBranchHandle.warnings.map(
        (warning) => `${mutation.action} from "${from}" to "${to}": ${warning}`
      )
    )
    if (normalizedBranchHandle.diagnostic) {
      diagnostics.push(
        `${mutation.action} from "${from}" to "${to}" failed: ${normalizedBranchHandle.diagnostic}`
      )
      return
    }
    if (normalizedBranchHandle.inputPatch) {
      const existingPatch = connectionInputPatches.get(from) || {}
      connectionInputPatches.set(from, {
        ...existingPatch,
        [normalizedBranchHandle.inputPatch.field]: normalizedBranchHandle.inputPatch.value,
      })
    }
    let rawTargetHandle = mutation.toHandle || 'target'
    const initialTargetHandleContainerType = expectedContainerTypeForSourceHandle(rawTargetHandle)
    if (
      initialTargetHandleContainerType &&
      targetBlockType === initialTargetHandleContainerType &&
      sourceBlockType !== initialTargetHandleContainerType
    ) {
      const isEndHandle = rawTargetHandle.endsWith('end-source')
      if (isEndHandle && sourceParentId === to) {
        warnings.push(
          `${mutation.action} from "${from}" to "${to}" used "${rawTargetHandle}" on toHandle. ` +
            `This pattern is implicit for subflow completion and was skipped. ` +
            `Use from=<${to}> with handle="${rawTargetHandle}" to route container exit to a downstream block.`
        )
        return
      }
      if (rawTargetHandle.endsWith('start-source')) {
        warnings.push(
          `${mutation.action} from "${from}" to "${to}" moved toHandle "${rawTargetHandle}" to default "target". ` +
            `Container start handles belong on the container as source handles.`
        )
        rawTargetHandle = 'target'
      }
    }
    const rawTargetHandleContainerType = expectedContainerTypeForSourceHandle(rawTargetHandle)
    if (
      rawTargetHandleContainerType &&
      targetBlockType === rawTargetHandleContainerType &&
      sourceBlockType !== rawTargetHandleContainerType
    ) {
      diagnostics.push(
        `${mutation.action} from "${from}" to "${to}" uses toHandle "${rawTargetHandle}" incorrectly. ` +
          `Container handles must be used as source handles on the container block. ` +
          `Use from=<container>, handle="${rawTargetHandle}", to=<target>.`
      )
      return
    }
    const normalizedHandles = normalizeContainerConnectionHandles({
      fromBlockId: from,
      toBlockId: to,
      sourceHandle: normalizedBranchHandle.sourceHandle,
      targetHandle: rawTargetHandle,
      sourceBlockType,
      targetBlockType,
      sourceParentId,
      targetParentId: String(workingState.blocks[to]?.data?.parentId || '') || null,
    })
    warnings.push(...normalizedHandles.warnings)
    const sourceHandle = normalizedHandles.sourceHandle
    const targetHandle = normalizedHandles.targetHandle
    let sourceMap = connectionState.get(from)
    if (!sourceMap) {
      sourceMap = new Map()
      connectionState.set(from, sourceMap)
    }
    const existingTargets = sourceMap.get(sourceHandle) || []
    const mode =
      mutation.action === 'disconnect'
        ? 'remove'
        : ('mode' in mutation ? mutation.mode : undefined) || 'set'
    const nextTargets = ensureConnectionTarget(existingTargets, { block: to, handle: targetHandle }, mode)
    sourceMap.set(sourceHandle, nextTargets)
    connectionTouchedSources.add(from)
    touchedBlocks.add(from)
  }

  const normalizeMutationValueWithWorkingState = (
    value: unknown,
    location: string
  ): unknown => {
    const referenceContext = buildReferenceValidationContext(workingState)
    const normalized = normalizeReferenceSyntaxForValue({
      value,
      context: referenceContext,
      knownEnvVarNames: knownEnvVarNamesSet,
    })
    if (normalized.warnings.length > 0) {
      warnings.push(...normalized.warnings.map((warning) => `${location}: ${warning}`))
    }
    return normalized.value
  }

  const applyEditParamsToWorkingState = (blockId: string, editParams: Record<string, any>): void => {
    const currentBlock = workingState.blocks[blockId]
    if (!currentBlock) return
    const nextBlock = { ...currentBlock }

    if (Object.prototype.hasOwnProperty.call(editParams, 'type') && editParams.type) {
      nextBlock.type = editParams.type
      plannedBlockTypes.set(blockId, String(editParams.type))
    }
    if (Object.prototype.hasOwnProperty.call(editParams, 'name') && editParams.name) {
      nextBlock.name = editParams.name
      const normalizedAlias = String(editParams.name).replace(/[^a-zA-Z0-9]/g, '')
      if (normalizedAlias) {
        aliasMap.set(normalizedAlias, blockId)
      }
    }
    if (Object.prototype.hasOwnProperty.call(editParams, 'triggerMode')) {
      nextBlock.triggerMode = editParams.triggerMode
    }
    if (Object.prototype.hasOwnProperty.call(editParams, 'advancedMode')) {
      nextBlock.advancedMode = editParams.advancedMode
    }
    if (Object.prototype.hasOwnProperty.call(editParams, 'enabled')) {
      nextBlock.enabled = editParams.enabled
    }
    if (editParams.inputs && typeof editParams.inputs === 'object') {
      const nextSubBlocks = { ...(nextBlock.subBlocks || {}) }
      for (const [key, value] of Object.entries(editParams.inputs)) {
        nextSubBlocks[key] = {
          id: key,
          value,
          type: nextSubBlocks[key]?.type || 'short-input',
        }
      }
      nextBlock.subBlocks = nextSubBlocks
    }

    workingState.blocks[blockId] = nextBlock
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
    const normalizedChangeValue = normalizeMutationValueWithWorkingState(
      change.value,
      `patch_block.${targetId}.${change.path}`
    )

    let pathSegments = normalizePathSegments(change.path)
    if (blockType && isContainerBlockType(blockType)) {
      pathSegments = normalizeContainerPatchPathSegments(targetId, blockType, pathSegments)
    }
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
      if (blockType === 'agent' && AGENT_LEGACY_PROMPT_FIELDS[inputKey]) {
        if (pathSegments.length > 2) {
          diagnostics.push(
            `Unsupported nested legacy agent prompt path "${change.path}" on ${targetId}. ` +
              `Use path "inputs.${inputKey}" or "inputs.messages".`
          )
          return
        }
        if (!['set', 'unset'].includes(change.op)) {
          diagnostics.push(
            `Unsupported op "${change.op}" for legacy agent prompt field "${inputKey}" on ${targetId}. ` +
              `Use set/unset or patch inputs.messages directly.`
          )
          return
        }
        const role = AGENT_LEGACY_PROMPT_FIELDS[inputKey]
        const currentMessages =
          paramsOut.inputs?.messages ??
          workingState.blocks[targetId]?.subBlocks?.messages?.value ??
          []
        let nextMessages = normalizeAgentMessages(currentMessages)
        if (change.op === 'unset') {
          nextMessages = removeAgentMessagesByRole(nextMessages, role)
        } else {
          nextMessages = upsertAgentMessageByRole(
            nextMessages,
            role,
            toMessageContent(normalizedChangeValue)
          )
        }
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs.messages = nextMessages
        warnings.push(
          `Converted legacy agent patch path "inputs.${inputKey}" to "inputs.messages" on ${targetId}`
        )
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
            ? setNestedValue(currentInputValue ?? {}, nestedPath, normalizedChangeValue)
            : normalizedChangeValue
      } else if (change.op === 'unset') {
        nextInputValue =
          nestedPath.length > 0 ? setNestedValue(currentInputValue ?? {}, nestedPath, null) : null
      } else if (change.op === 'merge') {
        if (nestedPath.length > 0) {
          const baseObject = getNestedValue(currentInputValue ?? {}, nestedPath) || {}
          if (
            baseObject &&
            typeof baseObject === 'object' &&
            normalizedChangeValue &&
            typeof normalizedChangeValue === 'object'
          ) {
            nextInputValue = setNestedValue(currentInputValue ?? {}, nestedPath, {
              ...baseObject,
              ...(normalizedChangeValue as Record<string, unknown>),
            })
          } else {
            diagnostics.push(`merge on ${targetId} at "${change.path}" requires object values`)
            return
          }
        } else if (
          currentInputValue &&
          typeof currentInputValue === 'object' &&
          !Array.isArray(currentInputValue) &&
          normalizedChangeValue &&
          typeof normalizedChangeValue === 'object' &&
          !Array.isArray(normalizedChangeValue)
        ) {
          nextInputValue = {
            ...currentInputValue,
            ...(normalizedChangeValue as Record<string, unknown>),
          }
        } else if (
          currentInputValue == null &&
          normalizedChangeValue &&
          typeof normalizedChangeValue === 'object'
        ) {
          nextInputValue = normalizedChangeValue
        } else {
          diagnostics.push(`merge on ${targetId} at "${change.path}" requires object values`)
          return
        }
      } else if (change.op === 'append') {
        const arr = Array.isArray(currentInputValue) ? [...currentInputValue] : []
        arr.push(normalizedChangeValue)
        nextInputValue = arr
      } else if (change.op === 'remove') {
        if (!Array.isArray(currentInputValue)) {
          diagnostics.push(`remove on ${targetId} at "${change.path}" requires an array value`)
          return
        }
        nextInputValue = removeArrayItem(currentInputValue, normalizedChangeValue)
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
    const topLevelToken = normalizeAliasToken(topLevelField)
    if (!['name', 'type', 'triggerMode', 'advancedMode', 'enabled'].includes(topLevelField)) {
      if (
        blockType === 'agent' &&
        ['systemPrompt', 'context', 'prompt', 'instructions', 'userPrompt'].includes(topLevelField)
      ) {
        if (!['set', 'unset'].includes(change.op)) {
          diagnostics.push(
            `Unsupported op "${change.op}" for agent field "${change.path}" on ${targetId}. ` +
              `Use set/unset or patch inputs.messages directly.`
          )
          return
        }
        const role = AGENT_LEGACY_PROMPT_FIELDS[topLevelField] || 'system'
        const currentMessages =
          paramsOut.inputs?.messages ??
          workingState.blocks[targetId]?.subBlocks?.messages?.value ??
          []
        let nextMessages = normalizeAgentMessages(currentMessages)
        if (change.op === 'unset') {
          nextMessages = removeAgentMessagesByRole(nextMessages, role)
        } else {
          nextMessages = upsertAgentMessageByRole(
            nextMessages,
            role,
            toMessageContent(normalizedChangeValue)
          )
        }
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs.messages = nextMessages
        warnings.push(
          `Converted legacy agent top-level field "${change.path}" to "inputs.messages" on ${targetId}`
        )
        return
      }
      if (blockType === 'condition' && (topLevelToken === 'conditions' || topLevelToken === 'branches')) {
        const currentConditions =
          paramsOut.inputs?.conditions ??
          workingState.blocks[targetId]?.subBlocks?.conditions?.value ??
          []
        let nextConditions: unknown = currentConditions
        if (change.op === 'set') {
          nextConditions = normalizedChangeValue
        } else if (change.op === 'unset') {
          nextConditions = []
        } else if (change.op === 'append') {
          const asArray = Array.isArray(currentConditions) ? [...currentConditions] : []
          asArray.push(normalizedChangeValue)
          nextConditions = asArray
        } else if (change.op === 'remove') {
          if (!Array.isArray(currentConditions)) {
            diagnostics.push(
              `remove on ${targetId} at "${change.path}" requires an array value for condition branches`
            )
            return
          }
          nextConditions = removeArrayItem(currentConditions, normalizedChangeValue)
        } else if (change.op === 'merge') {
          diagnostics.push(
            `merge on ${targetId} at "${change.path}" is not supported for condition branches. ` +
              `Use set/append/remove.`
          )
          return
        }
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs.conditions = nextConditions
        warnings.push(
          `Converted top-level condition path "${change.path}" to "inputs.conditions" on ${targetId}`
        )
        return
      }
      if (blockType === 'router_v2' && (topLevelToken === 'routes' || topLevelToken === 'route')) {
        const currentRoutes =
          paramsOut.inputs?.routes ??
          workingState.blocks[targetId]?.subBlocks?.routes?.value ??
          []
        let nextRoutes: unknown = currentRoutes
        if (change.op === 'set') {
          nextRoutes = normalizedChangeValue
        } else if (change.op === 'unset') {
          nextRoutes = []
        } else if (change.op === 'append') {
          const asArray = Array.isArray(currentRoutes) ? [...currentRoutes] : []
          asArray.push(normalizedChangeValue)
          nextRoutes = asArray
        } else if (change.op === 'remove') {
          if (!Array.isArray(currentRoutes)) {
            diagnostics.push(
              `remove on ${targetId} at "${change.path}" requires an array value for router routes`
            )
            return
          }
          nextRoutes = removeArrayItem(currentRoutes, normalizedChangeValue)
        } else if (change.op === 'merge') {
          diagnostics.push(
            `merge on ${targetId} at "${change.path}" is not supported for router routes. ` +
              `Use set/append/remove.`
          )
          return
        }
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs.routes = nextRoutes
        warnings.push(
          `Converted top-level router path "${change.path}" to "inputs.routes" on ${targetId}`
        )
        return
      }
      if (blockType === 'router_v2' && topLevelToken === 'context') {
        paramsOut.inputs = paramsOut.inputs || {}
        paramsOut.inputs.context = change.op === 'unset' ? null : normalizedChangeValue
        warnings.push(
          `Converted top-level router path "${change.path}" to "inputs.context" on ${targetId}`
        )
        return
      }
      diagnostics.push(`Unsupported top-level path "${change.path}" on ${targetId}`)
      return
    }
    if (
      topLevelField === 'type' &&
      change.op !== 'unset' &&
      typeof normalizedChangeValue === 'string' &&
      isContainerBlockType(normalizedChangeValue) &&
      String(workingState.blocks[targetId]?.data?.parentId || '').trim().length > 0
    ) {
      diagnostics.push(
        `patch_block on ${targetId} cannot set type "${normalizedChangeValue}" inside subflow "${String(
          workingState.blocks[targetId]?.data?.parentId || ''
        )}". Nested loop/parallel containers are not supported.`
      )
      return
    }
    paramsOut[topLevelField] = change.op === 'unset' ? null : normalizedChangeValue
  }

  for (const [mutationIndex, mutation] of (changeSpec.mutations || []).entries()) {
    if (mutation.action === 'ensure_block') {
      const targetId = resolveTarget(mutation.target, true)
      if (!targetId) {
        diagnostics.push('ensure_block is missing a resolvable target')
        continue
      }

      const existingBlock = workingState.blocks[targetId]
      if (existingBlock) {
        if (
          mutation.type &&
          isContainerBlockType(mutation.type) &&
          String(existingBlock?.data?.parentId || '').trim().length > 0
        ) {
          diagnostics.push(
            `ensure_block on ${targetId} cannot set type "${mutation.type}" inside subflow "${String(
              existingBlock?.data?.parentId || ''
            )}". Nested loop/parallel containers are not supported.`
          )
          continue
        }
        const editParams: Record<string, any> = {}
        if (mutation.name) editParams.name = mutation.name
        if (mutation.type) editParams.type = mutation.type
        if (mutation.inputs) {
          const normalizedMutationInputsValue = normalizeMutationValueWithWorkingState(
            mutation.inputs,
            `mutations[${mutationIndex}].inputs`
          )
          const targetBlockType =
            String(
              mutation.type ||
                workingState.blocks[targetId]?.type ||
                plannedBlockTypes.get(targetId) ||
                ''
            ) || ''
          const normalizedMutationInputs =
            targetBlockType === 'agent'
              ? normalizeLegacyAgentInputs({
                  targetId,
                  inputs: (normalizedMutationInputsValue as Record<string, any>) || {},
                  warnings,
                })
              : ((normalizedMutationInputsValue as Record<string, any>) || {})
          const validatedInputs = normalizeInputsWithSchema(
            targetId,
            targetBlockType,
            normalizedMutationInputs,
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
        applyEditParamsToWorkingState(targetId, editParams)
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
          const normalizedMutationInputsValue = normalizeMutationValueWithWorkingState(
            mutation.inputs,
            `mutations[${mutationIndex}].inputs`
          )
          const normalizedMutationInputs =
            mutation.type === 'agent'
              ? normalizeLegacyAgentInputs({
                  targetId,
                  inputs: (normalizedMutationInputsValue as Record<string, any>) || {},
                  warnings,
                })
              : ((normalizedMutationInputsValue as Record<string, any>) || {})
          const validatedInputs = normalizeInputsWithSchema(
            targetId,
            mutation.type,
            normalizedMutationInputs,
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
      if (editParams.inputs && blockType) {
        const normalizedInputs = normalizeInputsWithSchema(
          targetId,
          blockType,
          editParams.inputs,
          'patch_block'
        )
        if (Object.keys(normalizedInputs).length > 0) {
          editParams.inputs = normalizedInputs
        } else {
          delete editParams.inputs
        }
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
      applyEditParamsToWorkingState(targetId, editParams)
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
      delete workingState.blocks[targetId]
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
        if (isContainerBlockType(existingType)) {
          diagnostics.push(
            `insert_into_subflow cannot move container "${existingTargetId}" of type "${existingType}" into "${subflowId}". ` +
              'Nested loop/parallel containers are not supported.'
          )
          continue
        }
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
          const normalizedMutationInputsValue = normalizeMutationValueWithWorkingState(
            mutation.inputs,
            `mutations[${mutationIndex}].inputs`
          )
          const normalizedMutationInputs =
            existingType === 'agent'
              ? normalizeLegacyAgentInputs({
                  targetId: existingTargetId,
                  inputs: (normalizedMutationInputsValue as Record<string, any>) || {},
                  warnings,
                })
              : ((normalizedMutationInputsValue as Record<string, any>) || {})
          const validatedInputs = normalizeInputsWithSchema(
            existingTargetId,
            existingType,
            normalizedMutationInputs,
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
          type: existingType,
          name: existingName,
          subBlocks:
            insertParams.inputs && typeof insertParams.inputs === 'object'
              ? {
                  ...(existingBlock.subBlocks || {}),
                  ...Object.fromEntries(
                    Object.entries(insertParams.inputs).map(([key, value]) => [
                      key,
                      { id: key, value, type: existingBlock.subBlocks?.[key]?.type || 'short-input' },
                    ])
                  ),
                }
              : existingBlock.subBlocks,
          data: { ...(existingBlock.data || {}), parentId: subflowId, extent: 'parent' },
        }
        touchedBlocks.add(existingTargetId)
        touchedBlocks.add(subflowId)
        touchedSubflowIds.add(subflowId)
        continue
      }

      if (!mutation.type || !mutation.name) {
        diagnostics.push(
          `insert_into_subflow requires type and name when creating a new child block` +
            (targetId ? ` (target: "${targetId}")` : '')
        )
        continue
      }
      if (isContainerBlockType(mutation.type)) {
        diagnostics.push(
          `insert_into_subflow cannot create type "${mutation.type}" inside "${subflowId}". ` +
            'Nested loop/parallel containers are not supported.'
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
        const normalizedMutationInputsValue = normalizeMutationValueWithWorkingState(
          mutation.inputs,
          `mutations[${mutationIndex}].inputs`
        )
        const normalizedMutationInputs =
          mutation.type === 'agent'
            ? normalizeLegacyAgentInputs({
                targetId: targetId || blockId,
                inputs: (normalizedMutationInputsValue as Record<string, any>) || {},
                warnings,
              })
            : ((normalizedMutationInputsValue as Record<string, any>) || {})
        const validatedInputs = normalizeInputsWithSchema(
          targetId || blockId,
          mutation.type,
          normalizedMutationInputs,
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
      touchedSubflowIds.add(subflowId)
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
      touchedSubflowIds.add(subflowId)
      continue
    }

    if (mutation.action === 'connect' || mutation.action === 'disconnect') {
      deferredConnectionMutations.push({ mutation, mutationIndex })
      continue
    }
  }

  for (const { mutation } of deferredConnectionMutations) {
    applyConnectionMutation(mutation)
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

    const sourceBlockType = resolveBlockType(from)
    const targetBlockType = resolveBlockType(to)
    const sourceParentId = resolveParentId(from)
    const normalizedBranchHandle = normalizeBranchingSourceHandleForCompile({
      sourceBlockId: from,
      sourceBlockType,
      sourceHandle: normalizeHandle(link.from.handle),
      sourceBlock: workingState.blocks[from],
    })
    warnings.push(
      ...normalizedBranchHandle.warnings.map(
        (warning) => `link from "${from}" to "${to}": ${warning}`
      )
    )
    if (normalizedBranchHandle.diagnostic) {
      diagnostics.push(`link from "${from}" to "${to}" failed: ${normalizedBranchHandle.diagnostic}`)
      continue
    }
    if (normalizedBranchHandle.inputPatch) {
      const existingPatch = connectionInputPatches.get(from) || {}
      connectionInputPatches.set(from, {
        ...existingPatch,
        [normalizedBranchHandle.inputPatch.field]: normalizedBranchHandle.inputPatch.value,
      })
    }
    let rawTargetHandle = link.to.handle || 'target'
    const initialTargetHandleContainerType = expectedContainerTypeForSourceHandle(rawTargetHandle)
    if (
      initialTargetHandleContainerType &&
      targetBlockType === initialTargetHandleContainerType &&
      sourceBlockType !== initialTargetHandleContainerType
    ) {
      const isEndHandle = rawTargetHandle.endsWith('end-source')
      if (isEndHandle && sourceParentId === to) {
        warnings.push(
          `link from "${from}" to "${to}" used to.handle "${rawTargetHandle}". ` +
            `This child->container-end pattern is implicit and was skipped. ` +
            `Use from=<${to}>, from.handle="${rawTargetHandle}", to=<downstream>.`
        )
        continue
      }
      if (rawTargetHandle.endsWith('start-source')) {
        warnings.push(
          `link from "${from}" to "${to}" moved to.handle "${rawTargetHandle}" to "target". ` +
            `Container start handles belong on the container as source handles.`
        )
        rawTargetHandle = 'target'
      }
    }
    const rawTargetHandleContainerType = expectedContainerTypeForSourceHandle(rawTargetHandle)
    if (
      rawTargetHandleContainerType &&
      targetBlockType === rawTargetHandleContainerType &&
      sourceBlockType !== rawTargetHandleContainerType
    ) {
      diagnostics.push(
        `link from "${from}" to "${to}" uses to.handle "${rawTargetHandle}" incorrectly. ` +
          `Container handles must be used as source handles on the container block. ` +
          `Use from=<container>, from.handle="${rawTargetHandle}", to=<target>.`
      )
      continue
    }

    const normalizedHandles = normalizeContainerConnectionHandles({
      fromBlockId: from,
      toBlockId: to,
      sourceHandle: normalizedBranchHandle.sourceHandle,
      targetHandle: rawTargetHandle,
      sourceBlockType,
      targetBlockType,
      sourceParentId,
      targetParentId: String(workingState.blocks[to]?.data?.parentId || '') || null,
    })
    warnings.push(...normalizedHandles.warnings)
    const sourceHandle = normalizedHandles.sourceHandle
    const targetHandle = normalizedHandles.targetHandle
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
    const inputPatch = connectionInputPatches.get(sourceBlockId)
    const paramsOut: Record<string, unknown> = {
      connections: connectionStateToPayload(sourceConnections),
    }
    if (inputPatch && Object.keys(inputPatch).length > 0) {
      paramsOut.inputs = inputPatch
    }
    operations.push({
      operation_type: 'edit',
      block_id: sourceBlockId,
      params: paramsOut,
    })
  }

  const referenceWarnings = collectReferenceWarningsForChangeSpec({
    changeSpec,
    workflowState: workingState,
    knownEnvVarNames,
  })
  warnings.push(...referenceWarnings)
  addSubflowWiringWarnings({
    workflowState: workingState,
    connectionState,
    subflowIds: touchedSubflowIds,
    warnings,
  })

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

  const beforeCycle = detectDirectedCycle((params.workflowState.edges || []) as Array<Record<string, any>>)
  const afterCycle = detectDirectedCycle((state.edges || []) as Array<Record<string, any>>)
  if (afterCycle.hasCycle) {
    const cyclePath = formatCyclePathForDiagnostics({
      cyclePath: afterCycle.cyclePath,
      workflowState: state,
    })
    if (!beforeCycle.hasCycle) {
      diagnostics.push(
        `Workflow edit introduces a cycle (${cyclePath}). Use loop/parallel blocks for iteration instead of cyclic edges.`
      )
    } else {
      diagnostics.push(
        `Workflow still contains a cycle (${cyclePath}). Remove cyclic edges to keep the workflow acyclic.`
      )
    }
  }

  warnings.push(...collectUnusedIncomingPortWarnings(state))

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
        guidance: {
          diagnosticsBlocking: diagnostics.length > 0,
          warningsAdvisory: true,
          recommendedNextAction:
            diagnostics.length === 0 ? 'apply_proposal' : 'revise_changespec_before_apply',
          retryMutation: diagnostics.length > 0,
          summary:
            diagnostics.length === 0
              ? 'Dry run compiled successfully. Warnings are advisory unless they represent explicit missing wiring/credentials.'
              : 'Dry run has blocking diagnostics. Revise changeSpec before apply.',
        },
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
      guidance: {
        mutationApplied: applyResult?.success === true,
        postApplyPassed: evaluatorGate.passed,
        warningsAdvisory: true,
        recommendedNextAction: evaluatorGate.passed ? 'summarize_and_stop' : 'inspect_post_apply_failures',
        retryMutation: applyResult?.success !== true,
        summary: evaluatorGate.passed
          ? 'Apply completed and post-apply gate passed. Avoid additional mutation retries unless user requested further changes.'
          : 'Apply completed but post-apply gate failed. Inspect failures before any retry.',
      },
    }
  },
}
