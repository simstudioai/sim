import { stripVersionSuffix } from '@sim/utils/string'
import {
  type MothershipStreamV1EventEnvelope,
  MothershipStreamV1EventType,
  type MothershipStreamV1StreamScope,
  type MothershipStreamV1ToolExecutor,
  type MothershipStreamV1ToolMode,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { MothershipResourceType } from '@/lib/copilot/resources/types'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { SUBAGENT_LABELS, TOOL_UI_METADATA } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Reduces the raw {@link MothershipStreamV1EventEnvelope} stream into an
 * `ActivityModel` — the view-model the right-panel activity visualizer renders
 * from. Pure: `(model, envelope) => model`. Fold the `seq`-ordered envelope
 * sequence to rebuild state on resume/replay.
 *
 * This is the data layer of the "showcase what Sim is building" panel. The
 * renderer ({@link ../activity-view/activity-view}) never reads raw envelopes —
 * only this model.
 */

export type TurnPhase =
  | 'idle'
  | 'spinning-up'
  | 'thinking'
  | 'working'
  | 'streaming-artifact'
  | 'paused'
  | 'compacting'
  | 'complete'
  | 'errored'
  | 'cancelled'

export type SceneKind =
  | 'idle'
  | 'thinking'
  | 'workflow-build'
  | 'deploy'
  | 'authoring'
  | 'research'
  | 'data'
  | 'knowledge'
  | 'execution'
  | 'debug'
  | 'connect'
  | 'code'
  | 'tool-build'
  | 'job'
  | 'composite'

export type Topology = 'single' | 'sequential' | 'parallel' | 'nested' | 'mothership-only'

export type ActorState = 'spawning' | 'active' | 'delegating' | 'done' | 'failed'

export type ActivityState =
  | 'generating'
  | 'executing'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'rejected'

export type VerbFamily =
  | 'search'
  | 'read'
  | 'write'
  | 'execute'
  | 'data'
  | 'connect'
  | 'memory'
  | 'housekeeping'
  | 'agent'
  | 'other'

export type AttentionKind = 'confirmation' | 'credential' | 'usage-limit' | 'error'

export const MOTHERSHIP_ACTOR_ID = 'mothership'

export interface Actor {
  id: string
  /** Subagent key (`research`, `table`, …) or `mothership`. */
  key: string
  label: string
  state: ActorState
  parentToolCallId?: string
  depth: number
  startedAt: number
  endedAt?: number
}

export interface ActivityItem {
  toolCallId: string
  toolName: string
  verb: string
  family: VerbFamily
  ownerActorId: string
  executor: MothershipStreamV1ToolExecutor
  mode: MothershipStreamV1ToolMode
  state: ActivityState
  hidden: boolean
  startedAt: number
  endedAt?: number
}

export interface ActivityArtifact {
  resourceId: string
  type: MothershipResourceType
  title: string
  state: 'declared' | 'streaming' | 'ready' | 'removed'
  /** The agent lane that produced it, so the panel can preview it in-lane. */
  ownerActorId: string
}

export interface AttentionState {
  kind: AttentionKind
  provider?: string
  message?: string
  pendingToolCallIds?: string[]
}

export interface ActivityModel {
  phase: TurnPhase
  scene: SceneKind
  topology: Topology
  /** Stable lane order, by first appearance. Includes `mothership` lazily. */
  actorOrder: string[]
  actors: Record<string, Actor>
  activities: ActivityItem[]
  artifacts: Record<string, ActivityArtifact>
  attention?: AttentionState
  title?: string
  requestId?: string
}

export function createInitialActivityModel(): ActivityModel {
  return {
    phase: 'idle',
    scene: 'idle',
    topology: 'single',
    actorOrder: [],
    actors: {},
    activities: [],
    artifacts: {},
  }
}

const TERMINAL_PHASES: ReadonlySet<TurnPhase> = new Set(['complete', 'errored', 'cancelled'])
const TERMINAL_RANK: Record<string, number> = { complete: 0, errored: 1, cancelled: 2 }

/**
 * Guards phase transitions so late/stray events can't downgrade a terminal,
 * paused, or compacting state. See spec §7 (turn-phase precedence).
 */
function setPhase(phase: TurnPhase, next: TurnPhase): TurnPhase {
  if (TERMINAL_PHASES.has(phase)) {
    if (!TERMINAL_PHASES.has(next)) return phase
    return TERMINAL_RANK[next] >= TERMINAL_RANK[phase] ? next : phase
  }
  if (phase === 'paused' || phase === 'compacting') {
    if (next === 'working' || next === 'paused' || next === 'compacting') return next
    if (TERMINAL_PHASES.has(next)) return next
    return phase
  }
  return next
}

const VERB_FAMILY_BY_TOOL: Record<string, VerbFamily> = {
  glob: 'search',
  grep: 'search',
  search_online: 'search',
  search_library_docs: 'search',
  read: 'read',
  get_page_contents: 'read',
  scrape_page: 'read',
  workspace_file: 'write',
  edit_content: 'write',
  create_workflow: 'write',
  edit_workflow: 'write',
  function_execute: 'execute',
  user_table: 'data',
  knowledge_base: 'data',
  manage_mcp_tool: 'connect',
  manage_skill: 'connect',
  user_memory: 'memory',
  context_compaction: 'housekeeping',
  open_resource: 'housekeeping',
}

function toolFamily(toolName: string): VerbFamily {
  const base = stripVersionSuffix(toolName)
  if (VERB_FAMILY_BY_TOOL[base]) return VERB_FAMILY_BY_TOOL[base]
  if (base in SUBAGENT_LABELS) return 'agent'
  return 'other'
}

function titleCaseTool(toolName: string): string {
  return stripVersionSuffix(toolName)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function resolveVerb(toolName: string, ui?: { title?: string; phaseLabel?: string }): string {
  return (
    ui?.phaseLabel ||
    ui?.title ||
    TOOL_UI_METADATA[toolName as keyof typeof TOOL_UI_METADATA]?.title ||
    titleCaseTool(toolName)
  )
}

const SCENE_BY_ACTOR_KEY: Record<string, SceneKind> = {
  workflow: 'workflow-build',
  deploy: 'deploy',
  file: 'authoring',
  research: 'research',
  table: 'data',
  knowledge: 'knowledge',
  run: 'execution',
  debug: 'debug',
  auth: 'connect',
  agent: 'code',
  custom_tool: 'tool-build',
  job: 'job',
  superagent: 'composite',
}

const SCENE_BY_FAMILY: Partial<Record<VerbFamily, SceneKind>> = {
  search: 'research',
  read: 'research',
  write: 'authoring',
  execute: 'code',
  data: 'data',
  connect: 'connect',
}

/** Derives the dominant scene from the active actors / activities (spec §2). */
function resolveScene(model: ActivityModel): SceneKind {
  const liveActorKeys = model.actorOrder
    .map((id) => model.actors[id])
    .filter((a): a is Actor => !!a && a.id !== MOTHERSHIP_ACTOR_ID && a.state !== 'done')
    .map((a) => a.key)
  const distinct = [...new Set(liveActorKeys)]
  if (distinct.length >= 2) return 'composite'
  if (distinct.length === 1) return SCENE_BY_ACTOR_KEY[distinct[0]] ?? 'thinking'

  const lastActive = [...model.activities].reverse().find((act) => !act.hidden)
  if (lastActive) return SCENE_BY_FAMILY[lastActive.family] ?? 'thinking'
  return model.phase === 'idle' ? 'idle' : 'thinking'
}

function resolveTopology(model: ActivityModel): Topology {
  const subagents = model.actorOrder
    .map((id) => model.actors[id])
    .filter((a): a is Actor => !!a && a.id !== MOTHERSHIP_ACTOR_ID)
  if (subagents.length === 0) return 'mothership-only'
  if (subagents.some((a) => a.parentToolCallId)) return 'nested'
  const live = subagents.filter((a) => a.state !== 'done')
  if (live.length >= 2) return 'parallel'
  return subagents.length === 1 ? 'single' : 'sequential'
}

function actorIdFor(scope?: MothershipStreamV1StreamScope): string {
  if (scope?.lane === 'subagent') {
    return scope.agentId ?? `lane:${scope.parentToolCallId ?? 'unknown'}`
  }
  return MOTHERSHIP_ACTOR_ID
}

/**
 * The lane an artifact belongs to: the emitting subagent (via scope), else the
 * most recently active subagent, else Mothership.
 */
function artifactOwnerId(model: ActivityModel, scope?: MothershipStreamV1StreamScope): string {
  const scoped = actorIdFor(scope)
  if (scoped !== MOTHERSHIP_ACTOR_ID) return scoped
  for (let i = model.actorOrder.length - 1; i >= 0; i--) {
    const actor = model.actors[model.actorOrder[i]]
    if (actor && actor.id !== MOTHERSHIP_ACTOR_ID && actor.state !== 'done') return actor.id
  }
  return MOTHERSHIP_ACTOR_ID
}

function ensureMothership(model: ActivityModel): void {
  if (model.actors[MOTHERSHIP_ACTOR_ID]) return
  model.actors[MOTHERSHIP_ACTOR_ID] = {
    id: MOTHERSHIP_ACTOR_ID,
    key: MOTHERSHIP_ACTOR_ID,
    label: 'Mothership',
    state: 'active',
    depth: 0,
    startedAt: 0,
  }
  model.actorOrder.push(MOTHERSHIP_ACTOR_ID)
}

function depthFor(model: ActivityModel, parentToolCallId?: string): number {
  if (!parentToolCallId) return 1
  const owner = model.activities.find((a) => a.toolCallId === parentToolCallId)
  const parentActor = owner ? model.actors[owner.ownerActorId] : undefined
  return (parentActor?.depth ?? 0) + 1
}

/**
 * Folds one envelope into the model, returning a new model. Unknown event
 * types pass through unchanged.
 */
export function activityReducer(
  prev: ActivityModel,
  envelope: MothershipStreamV1EventEnvelope
): ActivityModel {
  const model: ActivityModel = {
    ...prev,
    actorOrder: [...prev.actorOrder],
    actors: { ...prev.actors },
    activities: [...prev.activities],
    artifacts: { ...prev.artifacts },
  }
  const ts = Number.isNaN(Date.parse(envelope.ts)) ? 0 : Date.parse(envelope.ts)

  switch (envelope.type) {
    case MothershipStreamV1EventType.session: {
      const { payload } = envelope
      if (payload.kind === 'start') model.phase = setPhase(model.phase, 'spinning-up')
      else if (payload.kind === 'title') model.title = payload.title
      else if (payload.kind === 'trace') model.requestId = payload.requestId
      break
    }

    case MothershipStreamV1EventType.text: {
      const isThinking = envelope.payload.channel === 'thinking'
      const ownerId = actorIdFor(envelope.scope)
      if (ownerId !== MOTHERSHIP_ACTOR_ID && model.actors[ownerId]) {
        model.actors[ownerId] = { ...model.actors[ownerId], state: 'active' }
      }
      model.phase = setPhase(model.phase, isThinking ? 'thinking' : 'working')
      break
    }

    case MothershipStreamV1EventType.tool: {
      const { payload } = envelope
      const ownerId = actorIdFor(envelope.scope)
      if (ownerId === MOTHERSHIP_ACTOR_ID) ensureMothership(model)

      if (payload.phase === 'call') {
        const hidden =
          isToolHiddenInUi(payload.toolName) ||
          payload.ui?.hidden === true ||
          payload.ui?.internal === true
        const item: ActivityItem = {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          verb: resolveVerb(payload.toolName, payload.ui),
          family: toolFamily(payload.toolName),
          ownerActorId: ownerId,
          executor: payload.executor,
          mode: payload.mode,
          state: payload.status === 'executing' ? 'executing' : 'generating',
          hidden,
          startedAt: ts,
        }
        const existing = model.activities.findIndex((a) => a.toolCallId === item.toolCallId)
        if (existing >= 0) model.activities[existing] = item
        else model.activities.push(item)
        if (payload.requiresConfirmation || payload.ui?.requiresConfirmation) {
          model.attention = { kind: 'confirmation', pendingToolCallIds: [payload.toolCallId] }
        }
        model.phase = setPhase(model.phase, 'working')
      } else if (payload.phase === 'result') {
        const idx = model.activities.findIndex((a) => a.toolCallId === payload.toolCallId)
        if (idx >= 0) {
          const nextState: ActivityState =
            (payload.status as ActivityState | undefined) ?? (payload.success ? 'success' : 'error')
          model.activities[idx] = { ...model.activities[idx], state: nextState, endedAt: ts }
        }
      }
      break
    }

    case MothershipStreamV1EventType.span: {
      const { payload } = envelope
      if (payload.kind === 'subagent') {
        const id = actorIdFor(envelope.scope)
        if (payload.event === 'start') {
          const key = payload.agent ?? 'agent'
          const parentToolCallId = envelope.scope?.parentToolCallId
          const actor: Actor = {
            id,
            key,
            label: SUBAGENT_LABELS[key] ?? titleCaseTool(key),
            state: 'active',
            parentToolCallId,
            depth: depthFor(model, parentToolCallId),
            startedAt: ts,
          }
          if (!model.actors[id]) model.actorOrder.push(id)
          model.actors[id] = actor
          model.phase = setPhase(model.phase, 'working')
        } else if (payload.event === 'end' && model.actors[id]) {
          model.actors[id] = { ...model.actors[id], state: 'done', endedAt: ts }
        }
      }
      break
    }

    case MothershipStreamV1EventType.resource: {
      const { payload } = envelope
      const { resource } = payload
      if (payload.op === 'upsert') {
        const existing = model.artifacts[resource.id]
        model.artifacts[resource.id] = {
          resourceId: resource.id,
          type: resource.type as MothershipResourceType,
          title: resource.title ?? existing?.title ?? 'Untitled',
          state: existing?.state ?? 'declared',
          ownerActorId: existing?.ownerActorId ?? artifactOwnerId(model, envelope.scope),
        }
      } else if (payload.op === 'remove' && model.artifacts[resource.id]) {
        model.artifacts[resource.id] = { ...model.artifacts[resource.id], state: 'removed' }
      }
      break
    }

    case MothershipStreamV1EventType.run: {
      const { payload } = envelope
      if (payload.kind === 'checkpoint_pause') {
        model.phase = setPhase(model.phase, 'paused')
        model.attention = {
          kind: 'confirmation',
          pendingToolCallIds: payload.pendingToolCallIds,
        }
      } else if (payload.kind === 'resumed') {
        if (model.attention?.kind === 'confirmation') model.attention = undefined
        model.phase = setPhase(model.phase, 'working')
      } else if (payload.kind === 'compaction_start') {
        model.phase = setPhase(model.phase, 'compacting')
      } else if (payload.kind === 'compaction_done') {
        model.phase = setPhase(model.phase, 'working')
      }
      break
    }

    case MothershipStreamV1EventType.error: {
      const { payload } = envelope
      const code = payload.code?.toLowerCase() ?? ''
      const isUsage = /usage|limit|quota|upgrade/.test(code)
      model.attention = {
        kind: isUsage ? 'usage-limit' : 'error',
        provider: payload.provider,
        message: payload.displayMessage ?? payload.message,
      }
      break
    }

    case MothershipStreamV1EventType.complete: {
      const status = envelope.payload.status
      model.phase = setPhase(
        model.phase,
        status === 'complete' ? 'complete' : status === 'cancelled' ? 'cancelled' : 'errored'
      )
      for (const id of model.actorOrder) {
        const actor = model.actors[id]
        if (actor && actor.state !== 'done' && actor.id !== MOTHERSHIP_ACTOR_ID) {
          model.actors[id] = { ...actor, state: 'done', endedAt: ts }
        }
      }
      break
    }

    default:
      return prev
  }

  model.scene = resolveScene(model)
  model.topology = resolveTopology(model)
  return model
}

/** Convenience: fold a whole sequence (e.g. for resume/replay). */
export function reduceActivity(
  envelopes: readonly MothershipStreamV1EventEnvelope[]
): ActivityModel {
  return envelopes.reduce(activityReducer, createInitialActivityModel())
}

/** Whether the turn is actively in-flight (panel should show the activity view). */
export function isTurnInFlight(model: ActivityModel): boolean {
  return (
    model.phase !== 'idle' &&
    model.phase !== 'complete' &&
    model.phase !== 'errored' &&
    model.phase !== 'cancelled'
  )
}
