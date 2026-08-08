import { resolveStreamToolOutcome } from '@/lib/copilot/chat/stream-tool-outcome'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  type MothershipStreamV1StreamScope,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/copilot/request/types'
import { getToolEntry } from '@/lib/copilot/tool-executor/router'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { getSubagentDisplayTitle } from '@/lib/copilot/tools/subagent-display'
import { getToolDisplayTitle, getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'

type ActivityState = 'running' | 'complete' | 'error'

/** A display-safe node in the public v2 chat activity tree. */
export interface V2ChatNodeActivity {
  kind: 'subagent' | 'tool'
  id: string
  parentId?: string
  label: string
  state: ActivityState
}

/** Display-safe assistant narration authored inside a subagent lane. */
export interface V2ChatNarrationActivity {
  kind: 'narration'
  parentId: string
  delta: string
}

export type V2ChatActivity = V2ChatNodeActivity | V2ChatNarrationActivity

interface ToolEventPayload {
  toolCallId?: unknown
  toolName?: unknown
  arguments?: unknown
  output?: unknown
  partial?: unknown
  phase?: unknown
  status?: unknown
  success?: unknown
  ui?: { hidden?: unknown; internal?: unknown } | null
}

interface ToolProjection {
  id?: string
  label?: string
  parentId?: string
  state?: ActivityState
  status?: string
  visibility: 'pending' | 'visible' | 'hidden'
  pendingState?: ActivityState
  pendingStatus?: string
}

interface AgentProjection {
  id: string
  label: string
  parentId?: string
  state: ActivityState
  emitted: boolean
}

interface ProjectedToolState {
  state: ActivityState
  status: string
}

interface DeferredWorkspaceFile {
  call: ToolEventPayload
  result?: ToolEventPayload
}

const ERROR_STATUSES = new Set<string>([
  MothershipStreamV1ToolStatus.error,
  MothershipStreamV1ToolStatus.cancelled,
  MothershipStreamV1ToolStatus.rejected,
])
const MAIN_SPAN = 'main'
const WORKSPACE_FILE_TOOL = 'workspace_file'
const FILE_SUBAGENT = 'file'

/**
 * Request-local projection of the private Mothership stream onto the public
 * activity tree. Raw span/tool ids, arguments, results, errors, and thinking
 * never cross this boundary.
 */
export class ChatActivityProjector {
  private readonly calls = new Map<string, ToolProjection>()
  private readonly agentsByKey = new Map<string, AgentProjection>()
  private readonly agents: AgentProjection[] = []
  private deferredWorkspaceFile?: DeferredWorkspaceFile
  private nextToolId = 1
  private nextAgentId = 1

  project(event: StreamEvent): V2ChatActivity[] {
    const activities: V2ChatActivity[] = []

    if (this.captureDeferredWorkspaceFileResult(event)) return activities

    const absorbsWorkspaceFile = this.absorbsDeferredWorkspaceFile(event)
    if (this.deferredWorkspaceFile && !absorbsWorkspaceFile && this.breaksDeferral(event)) {
      activities.push(...this.flushDeferredWorkspaceFile())
    }
    if (absorbsWorkspaceFile) this.hideDeferredWorkspaceFile()

    if (this.deferWorkspaceFileCall(event)) return activities

    switch (event.type) {
      case MothershipStreamV1EventType.span:
        activities.push(...this.projectSpan(event.payload, event.scope))
        break
      case MothershipStreamV1EventType.text:
        activities.push(...this.projectText(event.payload, event.scope))
        break
      case MothershipStreamV1EventType.tool:
        activities.push(...this.projectTool(event.payload, event.scope))
        break
    }

    return activities
  }

  /** Settle every public row before the route sends its terminal envelope. */
  finish(outcome: 'complete' | 'error'): V2ChatActivity[] {
    const activities: V2ChatActivity[] = []

    if (this.deferredWorkspaceFile) {
      const deferred = this.flushDeferredWorkspaceFile()
      const last = deferred.at(-1)
      // A deferred call was never visible. If it already completed, expose only
      // its terminal snapshot; otherwise the normal settlement below closes it.
      if (last?.kind === 'tool' && last.state !== 'running') activities.push(last)
    }

    for (const projection of this.calls.values()) {
      if (
        projection.visibility !== 'visible' ||
        !projection.id ||
        !projection.label ||
        projection.state !== 'running'
      ) {
        continue
      }
      activities.push(
        this.toolActivity(projection, {
          state: outcome === 'complete' ? 'complete' : 'error',
          status:
            outcome === 'complete'
              ? MothershipStreamV1ToolOutcome.success
              : MothershipStreamV1ToolOutcome.error,
        })
      )
    }

    // Children close before their parents, matching the visible activity tree.
    for (const agent of [...this.agents].reverse()) {
      if (!agent.emitted || agent.state !== 'running') continue
      agent.state = outcome
      activities.push(this.agentActivity(agent))
    }

    return activities
  }

  private projectSpan(payload: unknown, scope?: MothershipStreamV1StreamScope): V2ChatActivity[] {
    const span = record(payload)
    if (span?.kind !== MothershipStreamV1SpanPayloadKind.subagent) return []
    if (
      span.event !== MothershipStreamV1SpanLifecycleEvent.start &&
      span.event !== MothershipStreamV1SpanLifecycleEvent.end
    ) {
      return []
    }

    const data = record(span.data)
    const triggerToolCallId =
      stringValue(scope?.parentToolCallId) ??
      stringValue(data?.tool_call_id) ??
      stringValue(data?.toolCallId)
    const authoritativeAgent = stringValue(span.agent)
    const resolved = this.ensureAgent(scope, authoritativeAgent, triggerToolCallId, false)
    if (!resolved) return []
    const { agent, changed } = resolved

    if (span.event === MothershipStreamV1SpanLifecycleEvent.start) {
      const stateChanged = agent.state !== 'running'
      agent.state = 'running'
      if (!agent.emitted || changed || stateChanged) {
        agent.emitted = true
        return [this.agentActivity(agent)]
      }
      return []
    }

    // A checkpoint pause is resumable, not a completed subagent run.
    if (data?.pending === true) return []
    agent.state = stringValue(data?.error) ? 'error' : 'complete'
    agent.emitted = true
    return [this.agentActivity(agent)]
  }

  private projectText(payload: unknown, scope?: MothershipStreamV1StreamScope): V2ChatActivity[] {
    const text = record(payload)
    if (
      !scope ||
      text?.channel !== MothershipStreamV1TextChannel.assistant ||
      typeof text.text !== 'string' ||
      !text.text
    ) {
      return []
    }

    const resolved = this.ensureAgent(scope, undefined, undefined, true)
    if (!resolved) return []
    return [
      ...resolved.activities,
      { kind: 'narration', parentId: resolved.agent.id, delta: text.text },
    ]
  }

  private projectTool(payload: unknown, scope?: MothershipStreamV1StreamScope): V2ChatActivity[] {
    if (!payload || typeof payload !== 'object') return []
    const tool = payload as ToolEventPayload
    if (tool.phase === MothershipStreamV1ToolPhase.args_delta) return []
    if (
      tool.phase !== MothershipStreamV1ToolPhase.call &&
      tool.phase !== MothershipStreamV1ToolPhase.result
    ) {
      return []
    }

    const callId = stringValue(tool.toolCallId)
    const toolName = stringValue(tool.toolName)
    if (!callId || !toolName) return []

    const catalog = getToolEntry(toolName)
    if (catalog?.route === 'subagent') {
      this.calls.set(callId, { visibility: 'hidden' })
      if (
        tool.phase !== MothershipStreamV1ToolPhase.call ||
        tool.partial === true ||
        tool.status === MothershipStreamV1ToolStatus.generating
      ) {
        return []
      }
      return this.projectSubagentDispatch(callId, catalog.subagentId ?? toolName, scope)
    }

    const existing = this.calls.get(callId)
    if (existing?.visibility === 'hidden') return []

    if (this.isHidden(toolName, tool)) {
      this.calls.set(callId, { visibility: 'hidden' })
      return []
    }

    const activities: V2ChatActivity[] = []
    let parentId = existing?.parentId
    if (scope) {
      const resolved = this.ensureAgent(scope, undefined, undefined, true)
      if (!resolved) {
        this.calls.set(callId, { visibility: 'hidden' })
        return []
      }
      activities.push(...resolved.activities)
      parentId = resolved.agent.id
    }

    if (tool.phase === MothershipStreamV1ToolPhase.result) {
      const projectedState = toolState(tool)
      if (!existing || existing.visibility !== 'visible' || !existing.label) {
        this.calls.set(callId, {
          label: existing?.label,
          parentId,
          visibility: 'pending',
          pendingState: projectedState.state,
          pendingStatus: projectedState.status,
        })
        return activities
      }
      existing.parentId ??= parentId
      existing.pendingState = projectedState.state
      existing.pendingStatus = projectedState.status
      activities.push(this.toolActivity(existing, projectedState))
      return activities
    }

    const projection = existing ?? { visibility: 'pending' as const }
    const toolArguments = record(tool.arguments)
    const resolvedReadTargetName =
      toolName === 'read' ? getReadTargetBlock(stringValue(toolArguments?.path))?.name : undefined
    projection.label = getToolDisplayTitle(toolName, toolArguments, resolvedReadTargetName)
    projection.parentId ??= parentId

    // Generating calls can later resolve to a hidden/internal tool. Wait for
    // the authoritative call so the terminal never paints an orphan row.
    if (tool.partial === true || tool.status === MothershipStreamV1ToolStatus.generating) {
      this.calls.set(callId, projection)
      return activities
    }

    projection.visibility = 'visible'
    projection.id ??= this.publicToolId()
    this.calls.set(callId, projection)
    const projectedState = toolState(tool)
    activities.push(
      this.toolActivity(projection, {
        state: projection.pendingState ?? projectedState.state,
        status: projection.pendingStatus ?? projectedState.status,
      })
    )
    return activities
  }

  private ensureAgent(
    scope: MothershipStreamV1StreamScope | undefined,
    authoritativeAgent?: string,
    triggerToolCallId?: string,
    emit = true
  ):
    | {
        agent: AgentProjection
        activities: V2ChatActivity[]
        changed: boolean
      }
    | undefined {
    if (!scope || scope.lane !== 'subagent') return undefined
    const spanId = stringValue(scope.spanId)
    const triggerId = triggerToolCallId ?? stringValue(scope.parentToolCallId)
    const spanKey = spanId ? `span:${spanId}` : undefined
    const callKey = triggerId ? `call:${triggerId}` : undefined
    if (!spanKey && !callKey) return undefined

    let agent =
      (spanKey ? this.agentsByKey.get(spanKey) : undefined) ??
      (callKey ? this.agentsByKey.get(callKey) : undefined)
    if (!agent) {
      agent = {
        id: this.publicAgentId(),
        label: getSubagentDisplayTitle(authoritativeAgent ?? scope.agentId ?? ''),
        parentId: this.parentAgentId(scope, spanId),
        state: 'running',
        emitted: false,
      }
      this.agents.push(agent)
    }
    if (spanKey) this.agentsByKey.set(spanKey, agent)
    if (callKey) this.agentsByKey.set(callKey, agent)

    let changed = false
    if (authoritativeAgent) {
      const label = getSubagentDisplayTitle(authoritativeAgent)
      if (label !== agent.label) {
        agent.label = label
        changed = true
      }
    }
    const parentId = this.parentAgentId(scope, spanId)
    if (parentId && parentId !== agent.parentId) {
      agent.parentId = parentId
      changed = true
    }

    const activities: V2ChatActivity[] = []
    if (emit && (!agent.emitted || changed)) {
      agent.emitted = true
      activities.push(this.agentActivity(agent))
    }
    return { agent, activities, changed }
  }

  private projectSubagentDispatch(
    callId: string,
    agentId: string,
    scope?: MothershipStreamV1StreamScope
  ): V2ChatActivity[] {
    const activities: V2ChatActivity[] = []
    let parentId: string | undefined
    if (scope) {
      const parent = this.ensureAgent(scope, undefined, undefined, true)
      if (parent) {
        activities.push(...parent.activities)
        parentId = parent.agent.id
      }
    }

    const key = `call:${callId}`
    let agent = this.agentsByKey.get(key)
    const label = getSubagentDisplayTitle(agentId)
    if (!agent) {
      agent = {
        id: this.publicAgentId(),
        label,
        ...(parentId ? { parentId } : {}),
        state: 'running',
        emitted: false,
      }
      this.agentsByKey.set(key, agent)
      this.agents.push(agent)
    }
    const changed = agent.label !== label || (!!parentId && agent.parentId !== parentId)
    agent.label = label
    agent.parentId ??= parentId
    agent.state = 'running'
    if (!agent.emitted || changed) {
      agent.emitted = true
      activities.push(this.agentActivity(agent))
    }
    return activities
  }

  private parentAgentId(
    scope: MothershipStreamV1StreamScope,
    ownSpanId?: string
  ): string | undefined {
    const parentSpanId = stringValue(scope.parentSpanId)
    if (!parentSpanId || parentSpanId === MAIN_SPAN || parentSpanId === ownSpanId) return undefined
    const key = `span:${parentSpanId}`
    let parent = this.agentsByKey.get(key)
    if (!parent) {
      parent = {
        id: this.publicAgentId(),
        label: getSubagentDisplayTitle(''),
        state: 'running',
        emitted: false,
      }
      this.agentsByKey.set(key, parent)
      this.agents.push(parent)
    }
    return parent.id
  }

  private isHidden(toolName: string, tool: ToolEventPayload): boolean {
    const catalog = getToolEntry(toolName)
    return (
      tool.ui?.hidden === true ||
      tool.ui?.internal === true ||
      catalog?.hidden === true ||
      catalog?.internal === true ||
      isToolHiddenInUi(toolName) ||
      (toolName === 'read' &&
        stringValue(record(tool.arguments)?.path)?.startsWith('internal/tool-results/') === true)
    )
  }

  private deferWorkspaceFileCall(event: StreamEvent): boolean {
    if (event.type !== MothershipStreamV1EventType.tool || event.scope) return false
    const tool = event.payload as ToolEventPayload
    if (
      tool.phase !== MothershipStreamV1ToolPhase.call ||
      tool.toolName !== WORKSPACE_FILE_TOOL ||
      tool.partial === true ||
      tool.status === MothershipStreamV1ToolStatus.generating ||
      this.isHidden(WORKSPACE_FILE_TOOL, tool)
    ) {
      return false
    }
    this.deferredWorkspaceFile = { call: tool }
    return true
  }

  private captureDeferredWorkspaceFileResult(event: StreamEvent): boolean {
    const deferred = this.deferredWorkspaceFile
    if (!deferred || event.type !== MothershipStreamV1EventType.tool) return false
    const tool = event.payload as ToolEventPayload
    if (
      tool.phase !== MothershipStreamV1ToolPhase.result ||
      tool.toolName !== WORKSPACE_FILE_TOOL ||
      tool.toolCallId !== deferred.call.toolCallId
    ) {
      return false
    }
    deferred.result = tool
    return true
  }

  private absorbsDeferredWorkspaceFile(event: StreamEvent): boolean {
    const deferred = this.deferredWorkspaceFile
    if (
      !deferred ||
      event.type !== MothershipStreamV1EventType.span ||
      event.payload.kind !== MothershipStreamV1SpanPayloadKind.subagent ||
      event.payload.event !== MothershipStreamV1SpanLifecycleEvent.start
    ) {
      return false
    }
    const data = record(event.payload.data)
    const agent = stringValue(event.payload.agent) ?? stringValue(event.scope?.agentId)
    const triggerId =
      stringValue(event.scope?.parentToolCallId) ??
      stringValue(data?.tool_call_id) ??
      stringValue(data?.toolCallId)
    return agent === FILE_SUBAGENT && triggerId === deferred.call.toolCallId
  }

  private hideDeferredWorkspaceFile(): void {
    const deferred = this.deferredWorkspaceFile
    if (!deferred) return
    const callId = stringValue(deferred.call.toolCallId)
    if (callId) this.calls.set(callId, { visibility: 'hidden' })
    this.deferredWorkspaceFile = undefined
  }

  private flushDeferredWorkspaceFile(): V2ChatActivity[] {
    const deferred = this.deferredWorkspaceFile
    if (!deferred) return []
    this.deferredWorkspaceFile = undefined
    return [
      ...this.projectTool(deferred.call),
      ...(deferred.result ? this.projectTool(deferred.result) : []),
    ]
  }

  private breaksDeferral(event: StreamEvent): boolean {
    if (event.type === MothershipStreamV1EventType.tool) {
      const tool = event.payload as ToolEventPayload
      return tool.phase !== MothershipStreamV1ToolPhase.args_delta
    }
    if (event.type === MothershipStreamV1EventType.text) {
      return (
        event.payload.channel === MothershipStreamV1TextChannel.assistant && !!event.payload.text
      )
    }
    if (event.type === MothershipStreamV1EventType.span) {
      return event.payload.kind === MothershipStreamV1SpanPayloadKind.subagent
    }
    return (
      event.type === MothershipStreamV1EventType.error ||
      event.type === MothershipStreamV1EventType.complete
    )
  }

  private publicToolId(): string {
    return `tool-${this.nextToolId++}`
  }

  private publicAgentId(): string {
    return `agent-${this.nextAgentId++}`
  }

  private agentActivity(agent: AgentProjection): V2ChatNodeActivity {
    return {
      kind: 'subagent',
      id: agent.id,
      ...(agent.parentId ? { parentId: agent.parentId } : {}),
      label: agent.label,
      state: agent.state,
    }
  }

  private toolActivity(
    projection: ToolProjection,
    projectedState: ProjectedToolState
  ): V2ChatNodeActivity {
    projection.state = projectedState.state
    projection.status = projectedState.status
    return {
      kind: 'tool',
      id: projection.id!,
      ...(projection.parentId ? { parentId: projection.parentId } : {}),
      label: getToolStatusDisplayTitle(projection.label!, projectedState.status),
      state: projectedState.state,
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function toolState(tool: ToolEventPayload): ProjectedToolState {
  if (tool.phase === MothershipStreamV1ToolPhase.result) {
    const outcome = resolveStreamToolOutcome({
      output: tool.output,
      ...(typeof tool.status === 'string' ? { status: tool.status } : {}),
      ...(typeof tool.success === 'boolean' ? { success: tool.success } : {}),
    })
    return {
      state:
        outcome === MothershipStreamV1ToolOutcome.success ||
        outcome === MothershipStreamV1ToolOutcome.skipped
          ? 'complete'
          : 'error',
      status: outcome,
    }
  }
  const status = typeof tool.status === 'string' ? tool.status : 'running'
  if (tool.status === MothershipStreamV1ToolStatus.success) return { state: 'complete', status }
  if (tool.status === MothershipStreamV1ToolStatus.skipped) return { state: 'complete', status }
  if (ERROR_STATUSES.has(status)) return { state: 'error', status }
  return { state: 'running', status }
}
