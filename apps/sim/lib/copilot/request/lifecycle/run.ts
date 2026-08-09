import type { Context } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isPlainRecord, omit } from '@sim/utils/object'
import {
  type AttributedBillingRequestEnvelope,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  createAttributedBillingRequestEnvelope,
} from '@/lib/billing/core/billing-attribution'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_VERSION, TOOL_WATCHDOG_RESUME_GRACE_MS } from '@/lib/copilot/constants'
import {
  type CopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/copilot/environment-context'
import {
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
} from '@/lib/copilot/generated/billing-protocol-v1'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  COPILOT_CONTEXT_MODEL_TEXT_KEYS,
  COPILOT_CONTEXT_ROUTING_KEYS,
  COPILOT_DESKTOP_MODEL_TEXT_KEYS,
  COPILOT_MESSAGE_DISPLAY_KEYS,
  COPILOT_USER_METADATA_MODEL_TEXT_KEYS,
  COPILOT_VFS_MODEL_TEXT_KEYS,
  COPILOT_VFS_ROUTING_KEYS,
  isCopilotModelTextKey,
} from '@/lib/copilot/model-visible-content'
import {
  collectModelVisibleSchemaContent,
  getModelVisibleSchemaAction,
} from '@/lib/copilot/model-visible-schema'
import { getAutoAllowedTools } from '@/lib/copilot/persistence/tool-permission/auto-allow'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/copilot/request/context/result'
import {
  BillingLimitError,
  CopilotBackendError,
  runStreamLoop,
  StreamEndedWithoutTerminalError,
} from '@/lib/copilot/request/go/stream'
import {
  getToolCallTerminalData,
  requireToolCallStateResult,
} from '@/lib/copilot/request/tool-call-state'
import { handleBillingLimitResponse } from '@/lib/copilot/request/tools/billing'
import {
  cancelToolCallAndReport,
  executeToolAndReport,
  forceFailHungToolCall,
  pendingToolWaitBudgetMs,
} from '@/lib/copilot/request/tools/executor'
import type { TraceCollector } from '@/lib/copilot/request/trace'
import { RequestTraceV1SpanStatus } from '@/lib/copilot/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  ResumeContinuation,
  ResumeFrame,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'
import type { SecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { env } from '@/lib/core/config/env'
import {
  isCopilotBillingAttributionV1Enabled,
  isCopilotToolPermissionsEnabled,
  isHosted,
} from '@/lib/core/config/env-flags'
import { filterModelSafeWorkspaceFileAttachments } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotLifecycle')

const MAX_RESUME_ATTEMPTS = 3
const RESUME_BACKOFF_MS = [250, 500, 1000] as const
const MAX_SELECTED_CONTENT_NODES = 100_000
const MAX_SELECTED_CONTENT_DEPTH = 100
const SIMPLE_MODEL_CONTENT_KEYS = [
  'message',
  'systemPrompt',
  'workspaceContext',
  'commands',
  'implicitFeedback',
  'workflowName',
] as const
const TOOL_PAYLOAD_KEYS = ['tools', 'integrationTools', 'mothershipTools'] as const
const TOOL_SCHEMA_KEYS = new Set(['input_schema', 'parameters', 'outputs'])
const MOTHERSHIP_CODE_TOOL_ROUTES = new Set([
  '/api/copilot',
  '/api/mothership',
  '/api/mothership/execute',
])
const MESSAGE_CONTAINER_KEYS = new Set([
  'contentBlocks',
  'contexts',
  'display',
  'fileAttachments',
  'files',
  'function',
  'function_call',
  'result',
  'toolCall',
  'tool_calls',
])
const MESSAGE_OPAQUE_CONTENT_KEYS = new Set(['error', 'output', 'params'])
const ATTACHMENT_PARENT_KEYS = new Set(['attachments', 'fileAttachments', 'files'])
const MESSAGE_HANDLE_PARENT_KEYS = new Set(['function', 'function_call', 'toolCall'])

type SelectedContentAction =
  | 'preserve'
  | 'project'
  | 'project-json'
  | 'traverse'
  | 'traverse-verify-key'
  | 'verify-key-value'
  | 'verify'
type SelectedContentSelector = (
  path: readonly string[],
  key: string,
  value: unknown
) => SelectedContentAction

class CopilotModelContentProjectionError extends Error {
  constructor() {
    super('Copilot model input could not be safely projected')
    this.name = 'CopilotModelContentProjectionError'
  }
}

interface SelectedContentTraversalState {
  nodes: number
  ancestors: WeakSet<object>
}

interface SelectedContentBuckets {
  projected: unknown[]
  jsonStrings: string[]
  guarded: unknown[]
}

function visitSelectedContentNode(state: SelectedContentTraversalState, depth: number): void {
  state.nodes += 1
  if (state.nodes > MAX_SELECTED_CONTENT_NODES || depth > MAX_SELECTED_CONTENT_DEPTH) {
    throw new CopilotModelContentProjectionError()
  }
}

function projectModelContent(value: unknown, registry: ResolvedSecretTraceRegistry): unknown {
  const projection = projectResolvedSecretModelContent(value, registry)
  if (!projection.safe) throw new CopilotModelContentProjectionError()
  return projection.value
}

function collectSelectedContent(
  value: unknown,
  selector: SelectedContentSelector,
  selected: SelectedContentBuckets,
  path: readonly string[] = [],
  state: SelectedContentTraversalState = { nodes: 0, ancestors: new WeakSet<object>() },
  depth = 0
): void {
  visitSelectedContentNode(state, depth)
  if (value === null || typeof value !== 'object') return
  if (state.ancestors.has(value)) throw new CopilotModelContentProjectionError()

  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectSelectedContent(item, selector, selected, [...path, '*'], state, depth + 1)
      }
      return
    }
    if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()

    for (const [key, item] of Object.entries(value)) {
      const action = selector(path, key, item)
      if (action === 'project') {
        selected.projected.push(item)
      } else if (action === 'project-json') {
        if (typeof item !== 'string') throw new CopilotModelContentProjectionError()
        selected.jsonStrings.push(item)
      } else if (action === 'verify') {
        selected.guarded.push(item)
      } else if (action === 'verify-key-value') {
        selected.guarded.push(key, item)
      } else if (action === 'traverse' || action === 'traverse-verify-key') {
        if (action === 'traverse-verify-key') selected.guarded.push(key)
        collectSelectedContent(item, selector, selected, [...path, key], state, depth + 1)
      }
    }
  } finally {
    state.ancestors.delete(value)
  }
}

function restoreSelectedContent(
  value: unknown,
  selector: SelectedContentSelector,
  projected: readonly unknown[],
  projectedJsonStrings: readonly string[],
  cursor: { projected: number; jsonStrings: number },
  path: readonly string[] = [],
  state: SelectedContentTraversalState = { nodes: 0, ancestors: new WeakSet<object>() },
  depth = 0
): unknown {
  visitSelectedContentNode(state, depth)
  if (value === null || typeof value !== 'object') return value
  if (state.ancestors.has(value)) throw new CopilotModelContentProjectionError()

  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) =>
        restoreSelectedContent(
          item,
          selector,
          projected,
          projectedJsonStrings,
          cursor,
          [...path, '*'],
          state,
          depth + 1
        )
      )
    }
    if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()

    const restored: Record<string, unknown> = { ...value }
    for (const [key, item] of Object.entries(value)) {
      const action = selector(path, key, item)
      if (action === 'project') {
        if (cursor.projected >= projected.length) throw new CopilotModelContentProjectionError()
        restored[key] = projected[cursor.projected]
        cursor.projected += 1
      } else if (action === 'project-json') {
        if (cursor.jsonStrings >= projectedJsonStrings.length) {
          throw new CopilotModelContentProjectionError()
        }
        restored[key] = projectedJsonStrings[cursor.jsonStrings]
        cursor.jsonStrings += 1
      } else if (action === 'traverse' || action === 'traverse-verify-key') {
        restored[key] = restoreSelectedContent(
          item,
          selector,
          projected,
          projectedJsonStrings,
          cursor,
          [...path, key],
          state,
          depth + 1
        )
      }
    }
    return restored
  } finally {
    state.ancestors.delete(value)
  }
}

function projectSelectedContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry,
  selector: SelectedContentSelector
): unknown {
  const selected: SelectedContentBuckets = { projected: [], jsonStrings: [], guarded: [] }
  collectSelectedContent(value, selector, selected)
  if (!isResolvedSecretModelContentUnchanged(selected.guarded, registry)) {
    throw new CopilotModelContentProjectionError()
  }

  const projected = projectModelContent(selected.projected, registry)
  if (!Array.isArray(projected) || projected.length !== selected.projected.length) {
    throw new CopilotModelContentProjectionError()
  }
  const jsonProjection = projectResolvedSecretModelJsonStrings(selected.jsonStrings, registry)
  if (
    !jsonProjection.safe ||
    !Array.isArray(jsonProjection.value) ||
    !jsonProjection.value.every((item) => typeof item === 'string') ||
    jsonProjection.value.length !== selected.jsonStrings.length
  ) {
    throw new CopilotModelContentProjectionError()
  }
  const cursor = { projected: 0, jsonStrings: 0 }
  const restored = restoreSelectedContent(value, selector, projected, jsonProjection.value, cursor)
  if (cursor.projected !== projected.length || cursor.jsonStrings !== jsonProjection.value.length) {
    throw new CopilotModelContentProjectionError()
  }
  return restored
}

function projectStructuredContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry,
  selector: SelectedContentSelector,
  shape: 'array' | 'record' | 'record-or-array'
): unknown {
  if (
    (shape === 'array' && !Array.isArray(value)) ||
    (shape === 'record' && !isPlainRecord(value)) ||
    (shape === 'record-or-array' && !Array.isArray(value) && !isPlainRecord(value))
  ) {
    throw new CopilotModelContentProjectionError()
  }
  return projectSelectedContent(value, registry, selector)
}

function schemaContentAction(
  path: readonly string[],
  key: string,
  value: unknown
): SelectedContentAction {
  return getModelVisibleSchemaAction(path.at(-1), key, value)
}

const toolContentSelector: SelectedContentSelector = (path, key, value) => {
  if (path.length === 0 && key === 'description') return 'project'
  if (path.length === 0 && key === 'name') return 'verify'
  if (path.length === 0 && TOOL_SCHEMA_KEYS.has(key)) return 'traverse'

  const schemaRootIndex = path.findIndex((segment) => TOOL_SCHEMA_KEYS.has(segment))
  if (schemaRootIndex >= 0) {
    return schemaContentAction(path.slice(schemaRootIndex + 1), key, value)
  }
  return 'preserve'
}

const contextContentSelector: SelectedContentSelector = (_path, key, value) => {
  if (isCopilotModelTextKey(COPILOT_CONTEXT_MODEL_TEXT_KEYS, key)) return 'project'
  return value !== null && typeof value === 'object' ? 'traverse' : 'preserve'
}

function nearestPathContainer(path: readonly string[]): string | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index] !== '*') return path[index]
  }
  return undefined
}

const messageContentSelector: SelectedContentSelector = (path, key, value) => {
  if (key === 'content') {
    return value !== null && typeof value === 'object' ? 'traverse' : 'project'
  }
  if (MESSAGE_OPAQUE_CONTENT_KEYS.has(key)) return 'project'
  if (key === 'arguments') return 'project-json'
  if (isCopilotModelTextKey(COPILOT_MESSAGE_DISPLAY_KEYS, key)) return 'project'
  if (
    (key === 'name' || key === 'filename' || key === 'fileName') &&
    ATTACHMENT_PARENT_KEYS.has(nearestPathContainer(path) ?? '')
  ) {
    return 'project'
  }
  if (
    key === 'name' &&
    (path.length === 1 || MESSAGE_HANDLE_PARENT_KEYS.has(nearestPathContainer(path) ?? ''))
  ) {
    return 'verify'
  }
  if (key === 'name') return 'project'
  if (key === 'context' && nearestPathContainer(path) === 'files') return 'project'
  if (MESSAGE_CONTAINER_KEYS.has(key)) return 'traverse'
  return 'preserve'
}

const responseFormatContentSelector: SelectedContentSelector = (path, key, value) => {
  if (path.length === 0 && (key === 'description' || key === 'instructions')) return 'project'
  if (path.length === 0 && key === 'name') return 'verify'
  if (path.length === 0 && key === 'schema') return 'traverse'
  if (path.length === 0) return schemaContentAction(path, key, value)
  if (path[0] === 'schema') return schemaContentAction(path.slice(1), key, value)
  return 'preserve'
}

const vfsContentSelector: SelectedContentSelector = (_path, key, value) => {
  if (isCopilotModelTextKey(COPILOT_VFS_MODEL_TEXT_KEYS, key)) return 'project'
  return value !== null && typeof value === 'object' ? 'traverse' : 'preserve'
}

const userMetadataContentSelector: SelectedContentSelector = (_path, key) =>
  isCopilotModelTextKey(COPILOT_USER_METADATA_MODEL_TEXT_KEYS, key) ? 'project' : 'preserve'

const desktopContentSelector: SelectedContentSelector = (_path, key, value) => {
  if (isCopilotModelTextKey(COPILOT_DESKTOP_MODEL_TEXT_KEYS, key)) return 'project'
  return value !== null && typeof value === 'object' ? 'traverse' : 'preserve'
}

function projectModelSafeToolPayloads(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): unknown[] {
  if (!Array.isArray(value)) throw new CopilotModelContentProjectionError()

  const projected: unknown[] = []
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || typeof candidate.name !== 'string') continue

    try {
      for (const schemaKey of TOOL_SCHEMA_KEYS) {
        if (Object.hasOwn(candidate, schemaKey)) {
          collectModelVisibleSchemaContent(candidate[schemaKey])
        }
      }
      projected.push(projectStructuredContent(candidate, registry, toolContentSelector, 'record'))
    } catch {
      // Tool definitions are independent protocol entities. Reject an unsafe definition without
      // turning the entire catalog into one synthetic projection value or failing safe siblings.
    }
  }

  // Projection completeness is a request-level invariant, even when every candidate was rejected.
  projectModelContent([], registry)
  return projected
}

function hasModelSafeRoutingFields(
  value: Record<string, unknown>,
  routingKeys: readonly string[],
  registry: ResolvedSecretTraceRegistry
): boolean {
  for (const routingKey of routingKeys) {
    if (!Object.hasOwn(value, routingKey)) continue
    const routingValue = value[routingKey]
    if (
      typeof routingValue !== 'string' ||
      !isResolvedSecretModelContentUnchanged(routingValue, registry)
    ) {
      return false
    }
  }
  return true
}

function filterModelSafeContextPayload(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): Record<string, unknown> | unknown[] | undefined {
  if (Array.isArray(value)) {
    return value.filter(
      (candidate) =>
        isPlainRecord(candidate) &&
        hasModelSafeRoutingFields(candidate, COPILOT_CONTEXT_ROUTING_KEYS, registry)
    )
  }
  if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()
  return hasModelSafeRoutingFields(value, COPILOT_CONTEXT_ROUTING_KEYS, registry)
    ? value
    : undefined
}

function filterModelSafeVfsPayload(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()
  const filtered: Record<string, unknown> = { ...value }

  for (const [collectionKey, collection] of Object.entries(value)) {
    if (collectionKey === 'envVars') {
      if (!Array.isArray(collection) || !collection.every((item) => typeof item === 'string')) {
        throw new CopilotModelContentProjectionError()
      }
      filtered[collectionKey] = collection.filter((name) =>
        isResolvedSecretModelContentUnchanged(name, registry)
      )
      continue
    }
    if (!Array.isArray(collection)) continue

    filtered[collectionKey] = collection.filter((candidate) => {
      if (!isPlainRecord(candidate)) return false
      return hasModelSafeRoutingFields(candidate, COPILOT_VFS_ROUTING_KEYS, registry)
    })
  }

  return filtered
}

function filterModelSafeUserMetadata(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()
  const filtered = { ...value }
  if (
    Object.hasOwn(filtered, 'timezone') &&
    (typeof filtered.timezone !== 'string' ||
      !isResolvedSecretModelContentUnchanged(filtered.timezone, registry))
  ) {
    return omit(filtered, ['timezone'])
  }
  return filtered
}

function filterModelSafeDesktopCapabilities(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new CopilotModelContentProjectionError()
  const filtered: Record<string, unknown> = { ...value }

  if (Object.hasOwn(value, 'terminals')) {
    if (!Array.isArray(value.terminals)) throw new CopilotModelContentProjectionError()
    filtered.terminals = value.terminals.filter((terminal) => {
      if (!isPlainRecord(terminal)) return false
      return (
        !Object.hasOwn(terminal, 'cwd') ||
        (typeof terminal.cwd === 'string' &&
          isResolvedSecretModelContentUnchanged(terminal.cwd, registry))
      )
    })
  }

  if (Object.hasOwn(value, 'browserSessions')) {
    if (!Array.isArray(value.browserSessions)) throw new CopilotModelContentProjectionError()
    filtered.browserSessions = value.browserSessions.filter(
      (session) =>
        isPlainRecord(session) &&
        typeof session.hostname === 'string' &&
        isResolvedSecretModelContentUnchanged(session.hostname, registry)
    )
  }

  return filtered
}

function projectAttachmentDisplayNames(
  payload: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry
): Partial<Record<'attachments' | 'fileAttachments', unknown>> {
  const projected: Partial<Record<'attachments' | 'fileAttachments', unknown>> = {}
  for (const key of ['attachments', 'fileAttachments'] as const) {
    if (!Object.hasOwn(payload, key)) continue
    const attachments = payload[key]
    if (!Array.isArray(attachments)) throw new CopilotModelContentProjectionError()
    const displayNames = attachments.map((attachment) => {
      if (!isPlainRecord(attachment)) throw new CopilotModelContentProjectionError()
      return {
        ...(Object.hasOwn(attachment, 'name') ? { name: attachment.name } : {}),
        ...(Object.hasOwn(attachment, 'filename') ? { filename: attachment.filename } : {}),
      }
    })
    const projection = projectResolvedSecretModelContent(displayNames, registry)
    if (
      !projection.safe ||
      !Array.isArray(projection.value) ||
      projection.value.length !== attachments.length
    ) {
      throw new CopilotModelContentProjectionError()
    }
    const projectedDisplayNames = projection.value
    projected[key] = attachments.map((attachment, index) => {
      const displayName = projectedDisplayNames[index]
      if (!isPlainRecord(attachment) || !isPlainRecord(displayName)) {
        throw new CopilotModelContentProjectionError()
      }
      const name = displayName.name
      const filename = displayName.filename
      if (name !== undefined && typeof name !== 'string') {
        throw new CopilotModelContentProjectionError()
      }
      if (filename !== undefined && typeof filename !== 'string') {
        throw new CopilotModelContentProjectionError()
      }
      return {
        ...attachment,
        ...(name !== undefined ? { name } : {}),
        ...(filename !== undefined ? { filename } : {}),
      }
    })
  }
  return projected
}

async function omitUnsafeInitialCopilotAttachments(
  payload: Record<string, unknown>,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  let projected = payload
  for (const key of ['attachments', 'fileAttachments'] as const) {
    if (!Object.hasOwn(projected, key)) continue
    const attachments = projected[key]
    if (!Array.isArray(attachments)) throw new CopilotModelContentProjectionError()

    let safeAttachments: unknown[]
    try {
      safeAttachments = await filterModelSafeWorkspaceFileAttachments(attachments, { workspaceId })
    } catch (error) {
      logger.error('Workspace file secret provenance could not be verified', {
        attachmentCount: attachments.length,
        error: toError(error).message,
      })
      throw new CopilotModelContentProjectionError()
    }

    if (safeAttachments.length === attachments.length) continue
    logger.warn('Omitting Copilot attachments with unsafe secret provenance', {
      attachmentCount: attachments.length,
      omittedCount: attachments.length - safeAttachments.length,
    })
    projected =
      safeAttachments.length > 0 ? { ...projected, [key]: safeAttachments } : omit(projected, [key])
  }
  return projected
}

async function projectInitialCopilotPayload(
  payload: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  projectModelContent([], registry)
  let projectedPayload = { ...payload }
  const simpleContent: Record<string, unknown> = {}
  for (const key of SIMPLE_MODEL_CONTENT_KEYS) {
    if (Object.hasOwn(payload, key)) simpleContent[key] = payload[key]
  }
  const projectedSimpleContent = projectModelContent(simpleContent, registry)
  if (!isPlainRecord(projectedSimpleContent)) throw new CopilotModelContentProjectionError()
  for (const key of SIMPLE_MODEL_CONTENT_KEYS) {
    if (Object.hasOwn(payload, key) && Object.hasOwn(projectedSimpleContent, key)) {
      projectedPayload[key] = projectedSimpleContent[key]
    }
  }
  if (Object.hasOwn(payload, 'userTimezone')) {
    if (
      typeof payload.userTimezone === 'string' &&
      isResolvedSecretModelContentUnchanged(payload.userTimezone, registry)
    ) {
      projectedPayload.userTimezone = payload.userTimezone
    } else {
      projectedPayload = omit(projectedPayload, ['userTimezone'])
    }
  }

  if (Object.hasOwn(payload, 'messages')) {
    projectedPayload.messages = projectStructuredContent(
      payload.messages,
      registry,
      messageContentSelector,
      'array'
    )
  }
  for (const key of ['context', 'contexts'] as const) {
    if (Object.hasOwn(payload, key)) {
      if (typeof payload[key] === 'string') {
        projectedPayload[key] = projectModelContent(payload[key], registry)
        continue
      }
      const safeContexts = filterModelSafeContextPayload(payload[key], registry)
      if (safeContexts === undefined) {
        projectedPayload = omit(projectedPayload, [key])
      } else {
        projectedPayload[key] = projectStructuredContent(
          safeContexts,
          registry,
          contextContentSelector,
          'record-or-array'
        )
      }
    }
  }
  for (const key of TOOL_PAYLOAD_KEYS) {
    if (Object.hasOwn(payload, key)) {
      projectedPayload[key] = projectModelSafeToolPayloads(payload[key], registry)
    }
  }
  if (Object.hasOwn(payload, 'responseFormat')) {
    try {
      if (
        isPlainRecord(payload.responseFormat) &&
        Object.hasOwn(payload.responseFormat, 'schema')
      ) {
        collectModelVisibleSchemaContent(payload.responseFormat.schema)
      }
      projectedPayload.responseFormat =
        typeof payload.responseFormat === 'string'
          ? projectModelContent(payload.responseFormat, registry)
          : projectStructuredContent(
              payload.responseFormat,
              registry,
              responseFormatContentSelector,
              'record'
            )
    } catch {
      logger.warn('Omitting a Copilot response format with unsafe model-input provenance')
      projectedPayload = omit(projectedPayload, ['responseFormat'])
    }
  }
  if (Object.hasOwn(payload, 'vfs')) {
    projectedPayload.vfs = projectStructuredContent(
      filterModelSafeVfsPayload(payload.vfs, registry),
      registry,
      vfsContentSelector,
      'record'
    )
  }
  if (Object.hasOwn(payload, 'userMetadata')) {
    projectedPayload.userMetadata = projectStructuredContent(
      filterModelSafeUserMetadata(payload.userMetadata, registry),
      registry,
      userMetadataContentSelector,
      'record'
    )
  }
  if (Object.hasOwn(payload, 'desktopCapabilities')) {
    projectedPayload.desktopCapabilities = projectStructuredContent(
      filterModelSafeDesktopCapabilities(payload.desktopCapabilities, registry),
      registry,
      desktopContentSelector,
      'record'
    )
  }
  Object.assign(projectedPayload, projectAttachmentDisplayNames(payload, registry))
  return omitUnsafeInitialCopilotAttachments(projectedPayload, workspaceId)
}

async function ensureModelEgressRegistry(
  execContext: ExecutionContext,
  options: Pick<CopilotLifecycleOptions, 'environmentContext' | 'userId' | 'workspaceId'>
): Promise<ResolvedSecretTraceRegistry> {
  let registry = execContext.resolvedSecretTraceRegistry
  if (!registry) {
    const environmentContext =
      options.environmentContext ??
      (await prepareCopilotEnvironmentContext(options.userId, options.workspaceId))
    registry = environmentContext.resolvedSecretTraceRegistry
    execContext.resolvedSecretTraceRegistry = registry
  }
  return registry
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))]
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  return AbortSignal.any(activeSignals)
}

function resultContent(context: StreamingContext, options: CopilotLifecycleOptions): string {
  if (options.interactive === false && context.sawMainToolCall) {
    return context.finalAssistantContent
  }
  return context.accumulatedContent
}

export interface CopilotLifecycleOptions extends OrchestratorOptions {
  userId: string
  authorizationUserId?: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  /**
   * Defaults to true. Set false when `chatId` is transport-only and has no
   * parent row in Sim's `copilot_chats` table, or when the caller owns run
   * creation and supplies any persisted identity itself.
   */
  autoCreateRunIdentity?: boolean
  goRoute?: string
  resumeRoute?: string
  trace?: TraceCollector
  simRequestId?: string
  otelContext?: Context
  onGoTraceId?: (goTraceId: string) => void
  /** Fires after Go accepts the initial stream, before any resume legs. */
  onInitialStreamAccepted?: () => void
  executionContext?: ExecutionContext
  billingAttribution?: BillingAttributionSnapshot
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  environmentContext?: CopilotEnvironmentContext
  userPermission?: PermissionType
  secretMountPolicy?: SecretMountPolicy
  secretActorUserId?: string | null
}

/**
 * Seed the per-request tool permission state.
 *
 * This is the feature's single on-switch: everything downstream — stamping the
 * wire frame, holding the tool, drawing the card, persisting a decision — keys
 * off `enabled`, so a disabled request behaves exactly as it did before the
 * feature existed and never touches the preference tables.
 *
 * Beyond the flag, gating is limited to interactive mothership chats: that is
 * the only surface with a UI that can answer a prompt, so enabling it anywhere
 * else would hang the turn until the orchestration timeout with nothing to click.
 */
async function resolveToolPermissions(
  options: CopilotLifecycleOptions
): Promise<StreamingContext['toolPermissions']> {
  const enabled =
    isCopilotToolPermissionsEnabled &&
    options.interactive !== false &&
    (options.goRoute ?? '').startsWith('/api/mothership')
  if (!enabled) return { enabled: false, autoAllowed: new Set() }
  return { enabled: true, autoAllowed: await getAutoAllowedTools(options.userId, options.chatId) }
}

export async function runCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const {
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    goRoute = '/api/copilot',
  } = options
  const payloadMsgId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : generateId()
  const runIdentity = await ensureHeadlessRunIdentity({
    requestPayload,
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    autoCreateRunIdentity: options.autoCreateRunIdentity,
    messageId: payloadMsgId,
  })
  const resolvedExecutionId = runIdentity.executionId ?? executionId
  const resolvedRunId = runIdentity.runId ?? runId
  const toolAbortSignal = combineAbortSignals(options.abortSignal, options.userStopSignal)
  const lifecycleOptions: CopilotLifecycleOptions = {
    ...options,
    executionId: resolvedExecutionId,
    runId: resolvedRunId,
    ...(options.executionContext
      ? {
          executionContext: {
            ...options.executionContext,
            ...(options.authorizationUserId
              ? { authorizationUserId: options.authorizationUserId }
              : {}),
            messageId: payloadMsgId,
            executionId: resolvedExecutionId,
            runId: resolvedRunId,
            abortSignal: toolAbortSignal,
            userStopSignal: options.userStopSignal,
            billingAttribution:
              options.billingAttribution ?? options.executionContext.billingAttribution,
            ...(options.userPermission ? { userPermission: options.userPermission } : {}),
            ...(options.resolvedSecretTraceRegistry
              ? { resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry }
              : {}),
            ...(options.secretMountPolicy ? { secretMountPolicy: options.secretMountPolicy } : {}),
            ...(options.secretActorUserId !== undefined
              ? { secretActorUserId: options.secretActorUserId }
              : {}),
          },
        }
      : {}),
  }

  const execContext =
    lifecycleOptions.executionContext ??
    (await buildExecutionContext(requestPayload, {
      userId,
      authorizationUserId: lifecycleOptions.authorizationUserId,
      workflowId,
      workspaceId,
      chatId,
      executionId: resolvedExecutionId,
      runId: resolvedRunId,
      abortSignal: toolAbortSignal,
      userStopSignal: lifecycleOptions.userStopSignal,
      billingAttribution: lifecycleOptions.billingAttribution,
      resolvedSecretTraceRegistry: lifecycleOptions.resolvedSecretTraceRegistry,
      environmentContext: lifecycleOptions.environmentContext,
      userPermission: lifecycleOptions.userPermission,
      secretMountPolicy: lifecycleOptions.secretMountPolicy,
      secretActorUserId: lifecycleOptions.secretActorUserId,
    }))
  if (goRoute && MOTHERSHIP_CODE_TOOL_ROUTES.has(goRoute)) {
    execContext.sandboxProfile = 'mothership'
  } else {
    execContext.sandboxProfile = undefined
  }
  const shouldUseHostedBillingProtocol = isHosted && isCopilotBillingAttributionV1Enabled
  if (
    shouldUseHostedBillingProtocol &&
    execContext.workspaceId &&
    !execContext.billingAttribution
  ) {
    throw new Error('Billing attribution is required for hosted Copilot execution')
  }
  let hostedBillingRequest: AttributedBillingRequestEnvelope | undefined
  if (execContext.billingAttribution) {
    const billingAttribution = assertBillingAttributionSnapshot(execContext.billingAttribution)
    if (
      billingAttribution.actorUserId !== execContext.userId ||
      billingAttribution.workspaceId !== execContext.workspaceId
    ) {
      throw new Error('Copilot billing attribution does not match its actor and workspace')
    }
    execContext.billingAttribution = billingAttribution
    if (shouldUseHostedBillingProtocol) {
      hostedBillingRequest = createAttributedBillingRequestEnvelope(billingAttribution)
    }
  }

  const context = createStreamingContext({
    chatId,
    requestId: lifecycleOptions.simRequestId,
    executionId: resolvedExecutionId,
    runId: resolvedRunId,
    messageId: payloadMsgId,
    toolPermissions: await resolveToolPermissions(lifecycleOptions),
    ...(lifecycleOptions.trace ? { trace: lifecycleOptions.trace } : {}),
  })
  let onCompleteStarted = false

  try {
    const modelEgressRegistry = await ensureModelEgressRegistry(execContext, lifecycleOptions)
    const modelSafeRequestPayload = await projectInitialCopilotPayload(
      requestPayload,
      modelEgressRegistry,
      lifecycleOptions.workspaceId
    )
    await runCheckpointLoop(
      modelSafeRequestPayload,
      context,
      execContext,
      lifecycleOptions,
      goRoute,
      hostedBillingRequest
    )

    // The backend's terminal `complete` is the turn's verdict. A failure it
    // reported in-band on the way there — a tool or a subagent that failed and
    // was handed back to the model as data — belongs to a turn that still
    // finished, so it must not turn the whole request into an error and discard
    // the work the user watched succeed.
    const backendFinishedTurn =
      context.completionStatus === MothershipStreamV1CompletionStatus.complete
    const succeeded = !context.wasAborted && (backendFinishedTurn || context.errors.length === 0)

    const result: OrchestratorResult = {
      success: succeeded,
      // `cancelled` is an explicit discriminator so callers can tell
      // "user hit Stop" (persist partial assistant content through the
      // cancelled completion path) from "backend errored" (do clear the
      // row so the chat isn't stuck with a non-null `conversationId`).
      // An error that also
      // happens to fire the abort signal still counts as an error
      // path, but practically that doesn't happen in the success
      // branch here — if there are errors we never reach a
      // wasAborted-without-errors state.
      cancelled: context.wasAborted && context.errors.length === 0,
      content: resultContent(context, lifecycleOptions),
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      errors: !succeeded && context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }
    if (lifecycleOptions.onComplete) {
      onCompleteStarted = true
      await lifecycleOptions.onComplete(result)
    }
    return result
  } catch (error) {
    const err = toError(error)
    const wasCancelled = isAborted(lifecycleOptions, context)
    // A CopilotBackendError carries the upstream HTTP status + body (e.g. a 5xx
    // from /api/tools/resume when an oversized tool result — a rendered-doc
    // image — is posted back). Log those so a client-side "Stream error" that
    // originates from a thrown backend leg (vs an `error` SSE event) is
    // explained, not just reduced to a message string.
    const logFailure = wasCancelled ? logger.warn : logger.error
    logFailure.call(logger, 'Copilot orchestration failed', {
      error: err.message,
      name: err.name,
      ...(error instanceof CopilotBackendError
        ? { backendStatus: error.status, backendBody: error.body?.slice(0, 2000) }
        : {}),
    })
    // If the abort signal fired, this throw is a consequence of the
    // cancel (publisher.publish fails once the client disconnects, a
    // downstream Go read throws on ctx cancel, etc.) — NOT a real
    // backend error. Don't invoke `onError`, because on the cancel
    // path `onComplete(cancelled)` persists partial content with an
    // idempotent row-locked finalizer. `onError` would race with it via
    // `finalizeAssistantTurn`, clearing `conversationId` before the
    // partial content can be appended.
    // Return `cancelled: true` so upstream classification stays
    // consistent with the success-path cancel result.
    // Preserve whatever streamed before the throw for both terminals. A thrown
    // backend error (as opposed to an `error` SSE event that lets the loop finish
    // normally) must still carry the partial assistant turn so onError can
    // persist it — otherwise the post-error refetch replaces the rich live turn
    // with an empty assistant row and the UI appears to wipe the message +
    // subagent work.
    const result: OrchestratorResult = {
      success: false,
      cancelled: wasCancelled,
      content: context.accumulatedContent,
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      error: err.message,
      errors: context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }

    if (!wasCancelled) {
      await lifecycleOptions.onError?.(err, result)
    } else if (!onCompleteStarted && lifecycleOptions.onComplete) {
      try {
        await lifecycleOptions.onComplete(result)
      } catch (completeError) {
        logger.error('Cancelled copilot completion callback failed', {
          error: toError(completeError).message,
        })
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Per-subagent checkpoint resume (concurrent fan-out)
// ---------------------------------------------------------------------------
//
// Under the per-subagent checkpoint model each paused subagent is its OWN
// checkpoint chain (frame.checkpointId) joined at the orchestrator. Instead of
// one bundled /resume, Sim drives one resume chain per child CONCURRENTLY so a
// fast child never waits on a slow sibling, and the Go join wakes the
// orchestrator on whichever child finishes last. Gated by the Go
// `parallel-subagents` flag, surfaced here purely by frames carrying their own
// checkpointId.
//
// IMPORTANT (concurrency): JS is single-threaded, so the legs interleave at await
// points rather than running truly in parallel; shared accumulators
// (contentBlocks, toolCalls maps, errors) are appended via atomic synchronous
// ops and stay shared by reference. Only the per-leg STREAM CONTROL flags
// (streamComplete, awaitingAsyncContinuation) and the join-leg scalars
// (accumulatedContent/usage/cost) are isolated per leg and merged back.

type AsyncContinuation = ResumeContinuation

function isPerSubagentContinuation(c: AsyncContinuation): boolean {
  return !!c.frames && c.frames.length > 0 && c.frames.every((f) => !!f.checkpointId)
}

// Shared header set for every Sim -> Go mothership request (initial stream and
// every resume leg), so the auth/source/version headers can't drift between the
// sequential path and the concurrent per-subagent resume legs.
function mothershipRequestHeaders(
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    ...getMothershipSourceEnvHeaders(),
    'X-Client-Version': SIM_AGENT_VERSION,
    ...(hostedBillingRequest
      ? hostedBillingRequest.headers
      : isHosted && !isCopilotBillingAttributionV1Enabled
        ? {
            [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.legacy,
          }
        : {}),
  }
}

// makeResumeLegContext / mergeResumeLegOutputs are a PAIR and must stay in
// lockstep: every field reset here is folded back there, and nothing else on
// StreamingContext is per-leg. Everything not listed is shared BY REFERENCE
// across all concurrent legs (the one merged chat: contentBlocks, toolCalls,
// pendingToolPromises, inFlightToolExecutions, subagent maps, etc.). The per-leg ISOLATED set:
//   - streamComplete / awaitingAsyncContinuation: stream-control flags, so a
//     finished leg can't stop a sibling's read loop (reset only; not merged).
//   - accumulatedContent / finalAssistantContent / usage / cost: join-leg
//     scalars — only the join-carrying leg sets them; zeroing per leg keeps the
//     `+=` merge from multiplying the orchestrator's pre-fanout content by the
//     leg count, and keeps a child leg's stale usage/cost from clobbering the
//     join leg's real totals on merge.
//   - errors: a leg's transient retryable error (rolled back inside
//     runResumeLegWithRetry) must not truncate a concurrent sibling's shared
//     error array by index; each leg collects its own and merges the survivors.
//   - completionStatus: the backend's terminal verdict, set only on the leg that
//     carries the turn to its end; a stale one from a sibling would speak for a
//     turn that leg never finished.
// When adding a per-leg field, update BOTH functions (and the contract test in
// resume-leg-context.test.ts). Exported only for that test.
export function makeResumeLegContext(base: StreamingContext): StreamingContext {
  return {
    ...base,
    streamComplete: false,
    awaitingAsyncContinuation: undefined,
    accumulatedContent: '',
    finalAssistantContent: '',
    usage: undefined,
    cost: undefined,
    errors: [],
    completionStatus: undefined,
  }
}

// mergeResumeLegOutputs folds a finished leg's isolated scalars back into the
// shared context. Child (subagent-lane) legs leave the join scalars empty; only
// the join-carrying leg (which streams the orchestrator continuation) sets them.
export function mergeResumeLegOutputs(context: StreamingContext, leg: StreamingContext): void {
  if (leg.accumulatedContent) context.accumulatedContent += leg.accumulatedContent
  if (leg.finalAssistantContent) context.finalAssistantContent += leg.finalAssistantContent
  if (leg.usage) context.usage = leg.usage
  if (leg.cost) context.cost = leg.cost
  if (leg.sawMainToolCall) context.sawMainToolCall = true
  if (leg.wasAborted) context.wasAborted = true
  if (leg.errors.length > 0) context.errors.push(...leg.errors)
  if (leg.completionStatus) context.completionStatus = leg.completionStatus
}

type PendingToolWaitOutcome = 'settled' | 'aborted' | 'timed_out'

/**
 * Waits for tool work to stop before the lifecycle releases its chat lease.
 * Abort is remembered immediately, but the promise settles only after the
 * in-flight handlers have unwound. This is the same stop barrier the web UI
 * relies on: a queued turn must never overlap mutations from the stopped turn.
 */
function waitForPendingToolPromises(
  promises: Iterable<Promise<unknown>>,
  abortSignal?: AbortSignal,
  timeoutMs?: number
): Promise<PendingToolWaitOutcome> {
  const pending = Array.from(promises)
  if (pending.length === 0) return Promise.resolve('settled')

  return new Promise((resolve) => {
    let finished = false
    let abortObserved = abortSignal?.aborted ?? false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const finish = (outcome: PendingToolWaitOutcome) => {
      if (finished) return
      finished = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      abortSignal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => {
      abortObserved = true
      // Once Stop fires, safety wins over the ordinary resume watchdog: keep
      // the lease until the cancellation-aware handler has actually unwound.
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true })
    void Promise.allSettled(pending).then(() => finish(abortObserved ? 'aborted' : 'settled'))
    if (timeoutMs !== undefined && !abortObserved) {
      timeoutId = setTimeout(() => finish('timed_out'), timeoutMs)
    }
  })
}

async function waitForToolIds(
  context: StreamingContext,
  toolIds: string[],
  abortSignal?: AbortSignal
): Promise<PendingToolWaitOutcome> {
  const promises: Promise<unknown>[] = []
  for (const id of toolIds) {
    const p = context.pendingToolPromises.get(id)
    if (p) promises.push(p)
  }
  return waitForPendingToolPromises(promises, abortSignal)
}

function collectResultsForToolIds(
  context: StreamingContext,
  toolIds: string[],
  checkpointId: string,
  registry: ResolvedSecretTraceRegistry
): Array<{ callId: string; name: string; data: unknown; success: boolean }> {
  return toolIds.map((toolCallId) => {
    const tool = context.toolCalls.get(toolCallId)
    if (!tool || !tool.result) {
      throw new Error(
        `Cannot resume subagent chain ${checkpointId}: missing result for tool call ${toolCallId}`
      )
    }
    const name = tool.name || ''
    if (!isResolvedSecretModelContentUnchanged(name, registry)) {
      throw new CopilotModelContentProjectionError()
    }
    return {
      callId: toolCallId,
      name,
      data: getToolCallTerminalData(tool),
      success: requireToolCallStateResult(tool).success,
    }
  })
}

// runResumeLegWithRetry runs ONE resume POST with the same retryable-error +
// bounded-backoff policy the sequential checkpoint loop uses, so a concurrent
// child leg survives a transient Go 5xx (or network blip) instead of failing the
// whole turn — Go releases the claim on such errors expecting a retry. The leg's
// transient error is rolled back on its OWN (isolated) errors array so a
// recovered retry isn't mis-finalized as `error`. An AbortError (a sibling
// failure cancelling this leg, see driveSubagentChains) is non-retryable and
// propagates immediately.
async function runResumeLegWithRetry(
  url: string,
  body: Record<string, unknown>,
  leg: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<void> {
  let attempt = 0
  const stopSignal = combineAbortSignals(options.abortSignal, options.userStopSignal)
  for (;;) {
    const errorsBeforeAttempt = leg.errors.length
    try {
      await runStreamLoop(
        url,
        {
          method: 'POST',
          headers: mothershipRequestHeaders(hostedBillingRequest),
          body: JSON.stringify(body),
        },
        leg,
        execContext,
        options
      )
      return
    } catch (error) {
      if (isAborted(options, leg)) throw error
      if (isRetryableStreamError(error) && attempt < MAX_RESUME_ATTEMPTS - 1) {
        leg.errors.length = errorsBeforeAttempt
        attempt++
        const backoff = RESUME_BACKOFF_MS[attempt - 1] ?? 1000
        logger.warn('Child resume leg failed, retrying', {
          attempt: attempt + 1,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          backoffMs: backoff,
          error: toError(error).message,
        })
        await sleepWithAbort(backoff, stopSignal)
        if (isAborted(options, leg)) return
        continue
      }
      throw error
    }
  }
}

// driveOneChildChain resumes a single subagent's checkpoint chain to its end:
// resume -> (re-pause -> resume)* -> fold into join. Returns the orchestrator's
// follow-on continuation when THIS leg is the one the Go join woke (the last
// finisher whose /resume response carried the orchestrator continuation), else
// null. Re-pause vs follow-on is disambiguated by checkpoint id: a re-pause keeps
// the same child id; the join continuation is a different (orchestrator) id.
async function driveOneChildChain(
  frame: ResumeFrame,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  baseURL: string,
  workspaceId?: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<AsyncContinuation | null> {
  // ParentToolCallID is the SAME subagent's stable identity across re-pauses;
  // the checkpoint id rotates each re-pause (the prior one is already claimed).
  const parentToolCallId = frame.parentToolCallId
  // Guarded (not cast): a per-subagent frame always carries its own checkpointId
  // (isPerSubagentContinuation requires it), but a local guard keeps this driver
  // correct on its own terms rather than trusting a caller-side invariant.
  if (!frame.checkpointId) return null
  let checkpointId = frame.checkpointId
  let toolIds = frame.pendingToolIds
  const stopSignal = combineAbortSignals(options.abortSignal, options.userStopSignal)

  for (;;) {
    if (isAborted(options, context)) return null

    const waitOutcome = await waitForToolIds(context, toolIds, stopSignal)
    if (waitOutcome === 'aborted' || isAborted(options, context)) return null
    const registry = execContext.resolvedSecretTraceRegistry
    if (!registry) throw new CopilotModelContentProjectionError()
    const results = collectResultsForToolIds(context, toolIds, checkpointId, registry)

    const leg = makeResumeLegContext(context)
    await runResumeLegWithRetry(
      `${baseURL}${options.resumeRoute ?? '/api/tools/resume'}`,
      {
        streamId: context.messageId,
        checkpointId,
        userId: options.userId,
        ...(workspaceId ? { workspaceId } : {}),
        results,
      },
      leg,
      execContext,
      options,
      hostedBillingRequest
    )
    mergeResumeLegOutputs(context, leg)

    const cont = leg.awaitingAsyncContinuation
    if (!cont) {
      // The last finisher's leg, whose join continuation streamed the
      // orchestrator to completion (done): nothing more to drive on this leg.
      return null
    }
    // A NON-last finisher folds with a TERMINAL pause carrying the join id but
    // NO pending tools and NO frames — the child's work is done and the join
    // wakes on whichever sibling finishes last. End this leg cleanly; do NOT
    // mistake the join id for an orchestrator follow-on and try to resume it.
    const hasPending = (cont.pendingToolCallIds?.length ?? 0) > 0
    const hasFrames = (cont.frames?.length ?? 0) > 0
    if (!hasPending && !hasFrames) {
      return null
    }
    // Re-pause is identified by THIS subagent's stable parentToolCallId (the
    // checkpoint id rotates each re-pause). If present, keep driving this child
    // with its new id + leaves.
    const repaused = cont.frames?.find(
      (f) => f.parentToolCallId === parentToolCallId && f.checkpointId
    )
    if (repaused?.checkpointId) {
      checkpointId = repaused.checkpointId
      toolIds = repaused.pendingToolIds
      continue
    }
    // No frame for this subagent => the join fired and the orchestrator re-paused
    // on this leg. Hand it back to the main loop to continue the turn.
    return cont
  }
}

// driveSubagentChains fans out one resume chain per child frame concurrently and
// returns the single orchestrator follow-on continuation (if the orchestrator
// re-paused after the join), or null when the turn completed.
//
// Failure isolation: the legs share a per-fanout AbortController so the FIRST leg
// to fail cancels its siblings' in-flight resumes (otherwise a `Promise.all`
// reject leaves the siblings running detached — still mutating shared context and
// POSTing /resume after the turn has errored). The controller also chains off the
// caller's abort signal so a user stop cancels every leg. Each leg's failure is
// caught (so Promise.all can't reject before its siblings unwind); we then
// rethrow the first REAL error, not the AbortErrors it triggered in the siblings.
async function driveSubagentChains(
  continuation: AsyncContinuation,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  baseURL: string,
  workspaceId?: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<AsyncContinuation | null> {
  const frames = continuation.frames ?? []
  logger.info('Driving subagent checkpoint chains concurrently', {
    childCount: frames.length,
    checkpointIds: frames.map((f) => f.checkpointId),
  })

  const fanoutController = new AbortController()
  const parentSignal = options.abortSignal
  const onParentAbort = () => fanoutController.abort()
  if (parentSignal) {
    if (parentSignal.aborted) fanoutController.abort()
    else parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  const legOptions: CopilotLifecycleOptions = { ...options, abortSignal: fanoutController.signal }

  let firstError: unknown
  try {
    const followOns = await Promise.all(
      frames.map((frame) =>
        driveOneChildChain(
          frame,
          context,
          execContext,
          legOptions,
          baseURL,
          workspaceId,
          hostedBillingRequest
        ).catch((error) => {
          // First real failure wins and cancels the siblings; their resulting
          // AbortErrors arrive later and don't overwrite it. Swallow here so
          // Promise.all doesn't reject before every leg has unwound.
          if (firstError === undefined) firstError = error
          fanoutController.abort()
          return null
        })
      )
    )
    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      return null
    }
    if (firstError !== undefined) throw firstError
    return followOns.find((c): c is AsyncContinuation => !!c) ?? null
  } finally {
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

// ---------------------------------------------------------------------------
// Checkpoint loop – the core state machine
// ---------------------------------------------------------------------------

async function runCheckpointLoop(
  initialPayload: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  initialRoute: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<void> {
  let route = initialRoute
  const resumeRoute = options.resumeRoute ?? '/api/tools/resume'
  let payload: Record<string, unknown> = initialPayload
  let resumeAttempt = 0
  const callerOnEvent = options.onEvent
  let initialStreamAccepted = false
  const stopSignal = combineAbortSignals(options.abortSignal, options.userStopSignal)
  // Route by the identity that authorized this request, not by a projected
  // billing actor. Workspace API keys deliberately execute under a system
  // billing actor, but that actor's admin environment override must never
  // redirect another key owner's Mothership traffic.
  const mothershipBaseURL = await getMothershipBaseURL({
    userId: options.authorizationUserId ?? options.userId,
  })
  const lifecycleWorkspaceId = nonBlankString(options.workspaceId)

  // Go's auth middleware re-validates every Sim -> Go request by reading
  // workspaceId from the JSON body and forwarding it to Sim's validate route,
  // where it is required for the per-member usage gate. Normalize the initial
  // leg from the lifecycle option so callers that only set the option (not the
  // raw payload) still send it on the first request.
  if (lifecycleWorkspaceId && !nonBlankString(payload.workspaceId)) {
    payload = { ...payload, workspaceId: lifecycleWorkspaceId }
  }

  // Enterprise BYOK eligibility hint: set once on the initial mothership request
  // so Go only attempts a BYOK lookup for entitled workspaces. This is only a
  // gate — Go re-confirms entitlement authoritatively before using any key.
  payload = await withByokEligibilityHint(payload, route, lifecycleWorkspaceId)

  for (;;) {
    context.streamComplete = false
    const isResume = route === resumeRoute

    if (isResume && isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    if (isResume && options.runId) {
      try {
        await updateRunStatus(options.runId, 'resuming')
      } catch (error) {
        logger.warn('Failed to mark run as resuming', {
          runId: options.runId,
          error: toError(error).message,
        })
      }
    }

    const loopOptions = {
      ...options,
      onEvent: async (event: StreamEvent) => {
        if (
          event.type === MothershipStreamV1EventType.run &&
          event.payload.kind === MothershipStreamV1RunKind.checkpoint_pause &&
          options.runId
        ) {
          try {
            await updateRunStatus(options.runId, 'paused_waiting_for_tool')
          } catch (error) {
            logger.warn('Failed to mark run as paused_waiting_for_tool', {
              runId: options.runId,
              error: toError(error).message,
            })
          }
        }
        await callerOnEvent?.(event)
      },
    }

    const streamSpan = context.trace.startSpan(
      isResume ? 'Sim → Go (Resume)' : 'Sim → Go Stream',
      isResume ? 'lifecycle.resume' : 'sim.stream',
      {
        route,
        isResume,
        ...(isResume ? { attempt: resumeAttempt } : {}),
      }
    )
    context.trace.setActiveSpan(streamSpan)

    logger.info('Starting stream loop', {
      route,
      isResume,
      resumeAttempt,
      pendingToolPromises: context.pendingToolPromises.size,
      toolCallCount: context.toolCalls.size,
      hasCheckpoint: !!context.awaitingAsyncContinuation,
    })

    // Snapshot recorded errors before this attempt. If the attempt fails with
    // a retryable resume error, we roll back to this baseline before retrying
    // so a subsequent successful retry doesn't inherit the failed attempt's
    // errors (e.g. the 5xx the backend refused the leg with) and get
    // mis-finalized as `error`.
    const errorsBeforeAttempt = context.errors.length

    try {
      await runStreamLoop(
        `${mothershipBaseURL}${route}`,
        {
          method: 'POST',
          headers: mothershipRequestHeaders(hostedBillingRequest),
          body: JSON.stringify(payload),
        },
        context,
        execContext,
        {
          ...loopOptions,
          ...(!isResume && !initialStreamAccepted && options.onInitialStreamAccepted
            ? {
                onAccepted: () => {
                  if (initialStreamAccepted) return
                  initialStreamAccepted = true
                  options.onInitialStreamAccepted?.()
                },
              }
            : {}),
        }
      )
      const streamStatus = isAborted(options, context)
        ? RequestTraceV1SpanStatus.cancelled
        : context.errors.length > 0
          ? RequestTraceV1SpanStatus.error
          : RequestTraceV1SpanStatus.ok
      context.trace.endSpan(streamSpan, streamStatus)
      context.trace.setActiveSpan(undefined)
      resumeAttempt = 0
    } catch (streamError) {
      context.trace.endSpan(streamSpan, RequestTraceV1SpanStatus.error)
      context.trace.setActiveSpan(undefined)
      if (isAborted(options, context)) {
        await cancelCheckpointWork(context)
        throw streamError
      }
      if (streamError instanceof BillingLimitError) {
        await handleBillingLimitResponse(streamError.userId, context, execContext, options)
        break
      }
      if (
        isResume &&
        isRetryableStreamError(streamError) &&
        resumeAttempt < MAX_RESUME_ATTEMPTS - 1
      ) {
        // Discard errors recorded during this failed attempt; we're about to
        // redo this leg and a clean retry must not finalize as `error`.
        context.errors.length = errorsBeforeAttempt
        resumeAttempt++
        const backoff = RESUME_BACKOFF_MS[resumeAttempt - 1] ?? 1000
        logger.warn('Resume stream failed, retrying', {
          attempt: resumeAttempt + 1,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          backoffMs: backoff,
          error: toError(streamError).message,
        })
        await sleepWithAbort(backoff, stopSignal)
        continue
      }
      throw streamError
    }

    logger.info('Stream loop completed', {
      route,
      isResume,
      isAborted: isAborted(options, context),
      hasCheckpoint: !!context.awaitingAsyncContinuation,
      checkpointId: context.awaitingAsyncContinuation?.checkpointId,
      pendingToolPromises: context.pendingToolPromises.size,
      streamComplete: context.streamComplete,
      toolCallCount: context.toolCalls.size,
    })

    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    let continuation = context.awaitingAsyncContinuation
    if (!continuation) break

    // Per-subagent checkpoint model: fan out one concurrent resume chain per
    // child instead of a single bundled resume. The driver returns null when the
    // turn completed, or the orchestrator's follow-on continuation when it
    // re-paused after the join. A per-subagent follow-on (orchestrator spawned
    // more subagents) loops back through the driver; a normal follow-on falls
    // through to the sequential resume path below.
    if (isPerSubagentContinuation(continuation)) {
      context.awaitingAsyncContinuation = undefined
      let next: AsyncContinuation | null = continuation
      while (next && isPerSubagentContinuation(next)) {
        if (isAborted(options, context)) {
          await cancelCheckpointWork(context)
          next = null
          break
        }
        const waitOutcome = await waitForToolIds(context, next.pendingToolCallIds, stopSignal)
        if (waitOutcome === 'aborted') {
          await cancelCheckpointWork(context)
          next = null
          break
        }
        next = await driveSubagentChains(
          next,
          context,
          execContext,
          options,
          mothershipBaseURL,
          lifecycleWorkspaceId,
          hostedBillingRequest
        )
      }
      if (!next) break
      continuation = next
    }

    if (context.pendingToolPromises.size > 0) {
      // Bounded by the slowest pending tool's watchdog plus grace. The
      // per-tool watchdog already guarantees each promise settles; this gate
      // is the structural backstop so that no tool failure mode — known or
      // unknown — can park the checkpoint loop (and the chat's pending-stream
      // lock) forever.
      const waitBudgetMs =
        Array.from(context.pendingToolPromises.keys()).reduce(
          (max, toolCallId) =>
            Math.max(max, pendingToolWaitBudgetMs(context.toolCalls.get(toolCallId))),
          0
        ) + TOOL_WATCHDOG_RESUME_GRACE_MS
      const waitSpan = context.trace.startSpan('Wait for Tools', 'lifecycle.wait_tools', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
        waitBudgetMs,
      })
      logger.info('Waiting for in-flight tool executions before resume', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
        waitBudgetMs,
      })
      const waitOutcome = await waitForPendingToolPromises(
        context.pendingToolPromises.values(),
        stopSignal,
        waitBudgetMs
      )
      const settledInTime = waitOutcome === 'settled'
      if (waitOutcome === 'aborted') {
        waitSpan.attributes = { ...waitSpan.attributes, settledInTime: false, aborted: true }
        context.trace.endSpan(waitSpan, RequestTraceV1SpanStatus.cancelled)
        await cancelCheckpointWork(context)
        break
      }
      if (!settledInTime) {
        const hungToolCallIds = Array.from(context.pendingToolPromises.keys())
        logger.error('Pending tool executions exceeded the resume wait budget; force-failing', {
          checkpointId: continuation.checkpointId,
          waitBudgetMs,
          hungToolCallIds,
        })
        for (const toolCallId of hungToolCallIds) {
          await forceFailHungToolCall(
            toolCallId,
            context,
            'Tool execution hung on the Sim executor and was abandoned so the conversation could continue.'
          )
          context.pendingToolPromises.delete(toolCallId)
        }
      }
      waitSpan.attributes = { ...waitSpan.attributes, settledInTime }
      context.trace.endSpan(waitSpan)
    }

    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    const undispatchedToolIds = continuation.pendingToolCallIds.filter((toolCallId) => {
      const tool = context.toolCalls.get(toolCallId)
      return (
        !!tool &&
        !tool.result &&
        !tool.error &&
        !context.pendingToolPromises.has(toolCallId) &&
        tool.status !== 'executing'
      )
    })

    if (undispatchedToolIds.length > 0) {
      logger.warn('Checkpointed tools were never dispatched; executing before resume', {
        checkpointId: continuation.checkpointId,
        toolCallIds: undispatchedToolIds,
      })
      const waitOutcome = await waitForPendingToolPromises(
        undispatchedToolIds.map((toolCallId) =>
          executeToolAndReport(toolCallId, context, execContext, options)
        ),
        stopSignal
      )
      if (waitOutcome === 'aborted') {
        await cancelCheckpointWork(context)
        break
      }
    }

    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    const results: Array<{
      callId: string
      name: string
      data: unknown
      success: boolean
    }> = []
    for (const toolCallId of continuation.pendingToolCallIds) {
      if (isAborted(options, context)) {
        await cancelCheckpointWork(context)
        break
      }
      const tool = context.toolCalls.get(toolCallId)
      if (!tool || !tool.result) {
        logger.error('Missing tool result for pending tool call', {
          toolCallId,
          checkpointId: continuation.checkpointId,
          hasToolEntry: !!tool,
          toolName: tool?.name,
          toolStatus: tool?.status,
          hasPendingPromise: context.pendingToolPromises.has(toolCallId),
        })
        /**
         * Go is blocked on a result for every checkpointed call, so throwing
         * here ends the turn outright and the user loses the whole response.
         * Report the failure as that tool's result instead: the model sees one
         * failed call and can retry or route around it, which is how every
         * other tool failure already behaves. Reached only when a call was
         * checkpointed without Sim ever recording a result for it.
         */
        const failedName = tool?.name ?? ''
        results.push({
          callId: toolCallId,
          name: failedName,
          data: getToolCallTerminalData({
            id: toolCallId,
            name: failedName,
            status: MothershipStreamV1ToolOutcome.error,
            error: `Tool call ${toolCallId} produced no result before resume`,
          }),
          success: false,
        })
        continue
      }
      const name = tool.name || ''
      if (!isResolvedSecretModelContentUnchanged(name, execContext.resolvedSecretTraceRegistry)) {
        throw new CopilotModelContentProjectionError()
      }
      results.push({
        callId: toolCallId,
        name,
        data: getToolCallTerminalData(tool),
        success: requireToolCallStateResult(tool).success,
      })
    }

    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    logger.info('Resuming with tool results', {
      checkpointId: continuation.checkpointId,
      runId: continuation.runId,
      toolCount: results.length,
      pendingToolCallIds: continuation.pendingToolCallIds,
      frameCount: continuation.frames?.length ?? 0,
    })

    context.awaitingAsyncContinuation = undefined
    route = resumeRoute
    payload = {
      streamId: context.messageId,
      checkpointId: continuation.checkpointId,
      userId: options.userId,
      ...(lifecycleWorkspaceId ? { workspaceId: lifecycleWorkspaceId } : {}),
      results,
    }

    if (isAborted(options, context)) {
      await cancelCheckpointWork(context)
      break
    }

    logger.info('Prepared resume request payload', {
      route,
      streamId: context.messageId,
      checkpointId: continuation.checkpointId,
      resultCount: results.length,
    })
  }
}

// ---------------------------------------------------------------------------
// Execution context builder
// ---------------------------------------------------------------------------

async function buildExecutionContext(
  requestPayload: Record<string, unknown>,
  params: {
    userId: string
    authorizationUserId?: string
    workflowId?: string
    workspaceId?: string
    chatId?: string
    executionId?: string
    runId?: string
    abortSignal?: AbortSignal
    userStopSignal?: AbortSignal
    billingAttribution?: BillingAttributionSnapshot
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    environmentContext?: CopilotEnvironmentContext
    userPermission?: PermissionType
    secretMountPolicy?: SecretMountPolicy
    secretActorUserId?: string | null
  }
): Promise<ExecutionContext> {
  const {
    userId,
    authorizationUserId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    abortSignal,
    userStopSignal,
    billingAttribution,
    resolvedSecretTraceRegistry,
    environmentContext,
    userPermission,
    secretMountPolicy,
    secretActorUserId,
  } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined
  const requestMode = typeof requestPayload?.mode === 'string' ? requestPayload.mode : undefined
  const queryOnly = requestPayload?.queryOnly === true

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId, chatId, {
      workspaceId,
      billingAttribution,
      environmentContext,
    })
  } else {
    const activeEnvironmentContext =
      environmentContext ?? (await prepareCopilotEnvironmentContext(userId, workspaceId))
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      chatId,
      ...activeEnvironmentContext,
      billingAttribution,
    }
  }

  if (userTimezone) execContext.userTimezone = userTimezone
  if (authorizationUserId) execContext.authorizationUserId = authorizationUserId
  execContext.copilotToolExecution = true
  if (queryOnly) execContext.queryOnly = true
  if (requestMode) execContext.requestMode = requestMode
  if (userPermission) execContext.userPermission = userPermission
  execContext.messageId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : undefined
  execContext.executionId = executionId
  execContext.runId = runId
  execContext.abortSignal = abortSignal
  execContext.userStopSignal = userStopSignal
  if (billingAttribution) execContext.billingAttribution = billingAttribution
  if (resolvedSecretTraceRegistry) {
    execContext.resolvedSecretTraceRegistry = resolvedSecretTraceRegistry
  }
  if (secretMountPolicy) execContext.secretMountPolicy = secretMountPolicy
  if (secretActorUserId !== undefined) execContext.secretActorUserId = secretActorUserId
  return execContext
}

async function ensureHeadlessRunIdentity(input: {
  requestPayload: Record<string, unknown>
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  autoCreateRunIdentity?: boolean
  messageId: string
}): Promise<{ executionId?: string; runId?: string }> {
  if (input.autoCreateRunIdentity === false || !input.chatId || input.executionId || input.runId) {
    return {
      executionId: input.executionId,
      runId: input.runId,
    }
  }

  const executionId = generateId()
  const runId = generateId()

  try {
    await createRunSegment({
      id: runId,
      executionId,
      chatId: input.chatId,
      userId: input.userId,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      streamId: input.messageId,
      model: typeof input.requestPayload?.model === 'string' ? input.requestPayload.model : null,
      provider:
        typeof input.requestPayload?.provider === 'string' ? input.requestPayload.provider : null,
      requestContext: {
        source: 'headless_lifecycle',
      },
    })
    return { executionId, runId }
  } catch (error) {
    logger.warn('Failed to create headless run identity', {
      chatId: input.chatId,
      messageId: input.messageId,
      error: toError(error).message,
    })
    return {}
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adds `enterpriseByokEligible: true` to the initial mothership payload when the
 * workspace is on an enterprise plan. BYOK is mothership-only, so non-mothership
 * routes (e.g. `/api/copilot`) are left untouched. Failures default to hosted.
 */
async function withByokEligibilityHint(
  payload: Record<string, unknown>,
  route: string,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  // The eligibility hint is server-authoritative: always overwrite any
  // client-supplied value with a server-derived boolean so a client can never
  // assert its own eligibility. (Copilot's ValidateBYOK is the final authority,
  // but the hint must never originate from the client.) BYOK is mothership-only;
  // everything else gets an explicit false.
  let eligible = false
  if (workspaceId && route.startsWith('/api/mothership')) {
    try {
      eligible = await isWorkspaceOnEnterprisePlan(workspaceId)
    } catch (error) {
      logger.warn('Failed to resolve BYOK eligibility; defaulting to hosted', {
        workspaceId,
        error: toError(error).message,
      })
    }
  }
  return { ...payload, enterpriseByokEligible: eligible }
}

function isAborted(options: CopilotLifecycleOptions, context: StreamingContext): boolean {
  return !!(options.abortSignal?.aborted || options.userStopSignal?.aborted || context.wasAborted)
}

async function cancelCheckpointWork(context: StreamingContext): Promise<void> {
  context.wasAborted = true
  context.awaitingAsyncContinuation = undefined

  // The stop signal has already reached every tool context. Keep the chat
  // lease until those handlers observe it and unwind, then durably terminalize
  // any call that never reached its normal cancellation branch.
  await Promise.allSettled([
    ...context.pendingToolPromises.values(),
    ...(context.inFlightToolExecutions?.values() ?? []),
  ])
  await cancelPendingTools(context)
}

async function cancelPendingTools(context: StreamingContext): Promise<void> {
  const cancellations: Promise<void>[] = []
  for (const [toolCallId, toolCall] of context.toolCalls) {
    if (
      toolCall.status === 'pending' ||
      toolCall.status === 'executing' ||
      toolCall.status === 'awaiting_approval' ||
      toolCall.status === MothershipStreamV1ToolOutcome.cancelled
    ) {
      cancellations.push(cancelToolCallAndReport(toolCallId, context))
    }
  }
  await Promise.allSettled(cancellations)
}

/**
 * Only a leg the backend never took is worth re-posting: a network failure with
 * no response at all, or a 5xx it answered with — Go releases the checkpoint
 * claim on those, expecting the retry.
 *
 * Once the backend answers `200` the checkpoint is claimed and the leg runs to
 * whatever outcome it reaches, so a leg that ends early is reporting a result,
 * not a transport fault. Re-posting it reproduces the same result and bills the
 * leg again — which is why the resume payload no longer claims
 * `willRetryOnStreamError`: promising Go a transparent retry makes it suppress
 * the error tag that explains the failure, and nothing here would retry it.
 */
function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false
  }
  if (error instanceof StreamEndedWithoutTerminalError) {
    return false
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  if (error instanceof TypeError) {
    return true
  }
  return false
}

function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    return sleep(ms)
  }
  if (abortSignal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })
  })
}
