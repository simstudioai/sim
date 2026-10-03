import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/mothership/tools/retired-tools'
import {
  collectGroupTools,
  getNewestRunningTool,
  hasAgentGroupItemContent,
  isAgentGroupResolved,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import type {
  AgentGroupItem,
  NestedAgentGroup,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { needsToolInput } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** Keep answers and interactions in the transcript, outside collapsible tool history. */
function isStandaloneItem(item: AgentGroupItem): boolean {
  return (
    item.type !== 'tool' ||
    needsToolInput(item.data) ||
    item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID
  )
}

/** Interactions render as their own cards, so they never hold a lane's live indicator. */
function canHoldIndicator(tool: ToolCallData): boolean {
  return !needsToolInput(tool) && tool.toolName !== RETIRED_BROWSER_REQUEST_TAKEOVER_ID
}

/** A run of consecutive calls the main lane renders together, as one activity group. */
export interface ActivityRun {
  tools: ToolCallData[]
}

export type MainLaneEntry =
  | { type: 'run'; run: ActivityRun }
  | { type: 'item'; item: AgentGroupItem; index: number }

/**
 * How the main lane lays out its items: consecutive calls form runs,
 * including search and document reads, and an interaction stands
 * on its own and closes the run before it.
 */
export function splitMainLane(items: AgentGroupItem[]): MainLaneEntry[] {
  const entries: MainLaneEntry[] = []
  let run: ActivityRun | undefined
  for (const [index, item] of items.entries()) {
    if (item.type === 'tool' && !isStandaloneItem(item)) {
      if (!run) {
        run = { tools: [] }
        entries.push({ type: 'run', run })
      }
      run.tools.push(item.data)
      continue
    }
    run = undefined
    entries.push({ type: 'item', item, index })
  }
  return entries
}

export interface ActiveBrowserTakeover {
  id: string
  reason: string
}

/**
 * This lane's own active browser hand-back, if any. Browser-agent calls are
 * serialized, so only the lane's latest call can be one: a newer call makes an
 * older takeover stale.
 */
export function getActiveBrowserTakeover(items: AgentGroupItem[]): ActiveBrowserTakeover | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type !== 'tool') continue
    if (
      item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID &&
      item.data.status === ToolCallStatus.executing
    ) {
      const reason = item.data.params?.reason
      return { id: item.data.id, reason: typeof reason === 'string' ? reason.trim() : '' }
    }
    return null
  }
  return null
}

/**
 * The lane, or a lane nested in it, is waiting on the user: a permission
 * decision or terminal handoff, and, when `includeBrowserTakeover` is set, a
 * browser takeover (which lanes reveal through their own question instead).
 */
export function hasPendingInteraction(
  items: AgentGroupItem[],
  includeBrowserTakeover = false
): boolean {
  return (
    (includeBrowserTakeover && getActiveBrowserTakeover(items) !== null) ||
    items.some((item) =>
      item.type === 'tool'
        ? needsToolInput(item.data)
        : item.type === 'agent_group' &&
          hasPendingInteraction(item.group.items, includeBrowserTakeover)
    )
  )
}

/** The lane, or a lane nested in it, is waiting on the user rather than on work. */
function isLaneAwaitingUser(items: AgentGroupItem[]): boolean {
  return hasPendingInteraction(items, true)
}

/**
 * A subagent lane is working while it has not failed and is either delegating
 * unfinished calls or open on a live stream.
 */
export function isLaneWorking(
  lane: Pick<NestedAgentGroup, 'error' | 'isDelegating' | 'isOpen' | 'items'>,
  isStreaming: boolean
): boolean {
  return (
    !lane.error &&
    ((lane.isDelegating && !isAgentGroupResolved(lane.items)) || (isStreaming && lane.isOpen))
  )
}

/**
 * What owns a lane's live indicator: one call, or, for a subagent lane with
 * narration but no calls yet, the lane's own "Thinking" header.
 */
export type LaneLiveIndicator = { type: 'call'; tool: ToolCallData } | { type: 'narration' }

export interface LaneActivityInput {
  kind: 'main' | 'subagent'
  /** The lane's items; the main lane passes one part per transcript segment, in order. */
  parts: AgentGroupItem[][]
  /** The stream is running and the lane can still work, so it may show an indicator at all. */
  isActive: boolean
  /** Nothing has closed the lane's last run, so a finished latest call can still own the gap. */
  isOpen: boolean
}

/** The latest call of the main lane's last run, which owns the trailing gap. */
function getMainTrailingCall(items: AgentGroupItem[]): ToolCallData | undefined {
  const last = splitMainLane(items).at(-1)
  return last?.type === 'run' ? last.run.tools.at(-1) : undefined
}

/**
 * The one live indicator of a lane, if it has one. See
 * {@link getTurnLiveIndicators} for the rule this implements.
 */
export function getLaneLiveIndicator({
  kind,
  parts,
  isActive,
  isOpen,
}: LaneActivityInput): LaneLiveIndicator | undefined {
  if (!isActive || parts.some(isLaneAwaitingUser)) return undefined
  const calls = parts.flatMap(collectGroupTools).filter(canHoldIndicator)
  const running = getNewestRunningTool(calls)
  if (running) return { type: 'call', tool: running }
  if (!isOpen) return undefined
  if (kind === 'subagent' && calls.length === 0) {
    return parts.some((items) => items.some(hasAgentGroupItemContent))
      ? { type: 'narration' }
      : undefined
  }
  const latest = kind === 'main' ? getMainTrailingCall(parts.at(-1) ?? []) : calls.at(-1)
  return latest?.status === ToolCallStatus.success ? { type: 'call', tool: latest } : undefined
}

/** A top-level lane of the turn, as the transcript segments it. */
export interface TurnLane extends Pick<NestedAgentGroup, 'error' | 'isDelegating' | 'isOpen'> {
  id: string
  agentName: string
  items: AgentGroupItem[]
}

/** The thinking row stays hidden while a lane shows a live indicator or waits on the user. */
export function ownsTurnWait({ isAwaitingUser, byLane }: TurnLiveIndicators): boolean {
  return isAwaitingUser || byLane.size > 0
}

export interface TurnLiveIndicators {
  /** Some lane is waiting on the user, so the thinking row stays hidden. */
  isAwaitingUser: boolean
  /** Each top-level lane's indicator by lane id; every main-lane segment shares the main one. */
  byLane: ReadonlyMap<string, LaneLiveIndicator>
}

/**
 * The live indicators of a turn. This is the single owner of the rule:
 *
 * - One live indicator per active lane. The turn-level thinking row shows only
 *   when no lane has a live indicator and the turn is not waiting on the user.
 *   Once the stream finishes, nothing shimmers.
 * - Within a lane there is at most one current live call: the newest running
 *   call anywhere in the lane, across all of its runs and the lanes nested in
 *   it. With none running and the lane open, the latest call of its trailing
 *   run owns the gap, and is live only if it succeeded; an error, rejection,
 *   stop, skip, or interruption hands the wait to the thinking row. A subagent
 *   lane's trailing call is its latest call, and an open subagent lane with
 *   narration but no calls shows its own "Thinking" header.
 * - Only the run holding the live call shimmers through its tool group header.
 *   A parent lane whose live call sits in a nested lane defers
 *   to that lane while the nested lane is still working and visible; a nested
 *   lane that has ended hands its last call back to the parent.
 * - A header reads in the present tense exactly while it is live or its call
 *   is still running, so tense always agrees with the shimmer.
 * - A lane waiting on the user (a pending approval, a terminal handoff, or a
 *   browser takeover, in the lane or a lane nested in it) shows no indicator:
 *   its interactive card is the call to action. Other lanes that are still
 *   live keep their one indicator, since hiding real parallel work would
 *   misrepresent it. The thinking row stays hidden while any lane waits.
 *
 * The main lane spans every main-agent segment of the transcript: prose and
 * activity changes split it into segments, but it is one lane with one
 * indicator.
 */
export function getTurnLiveIndicators(lanes: TurnLane[], isStreaming: boolean): TurnLiveIndicators {
  const byLane = new Map<string, LaneLiveIndicator>()
  const isAwaiting = lanes.some((lane) => isLaneAwaitingUser(lane.items))
  if (!isStreaming) return { isAwaitingUser: isAwaiting, byLane }
  const mainParts = lanes.filter((lane) => lane.agentName === 'mothership')
  const mainIndicator = getLaneLiveIndicator({
    kind: 'main',
    parts: mainParts.map((lane) => lane.items),
    isActive: true,
    isOpen: mainParts.at(-1)?.isOpen === true,
  })
  for (const lane of lanes) {
    const working = lane.agentName !== 'mothership' && isLaneWorking(lane, isStreaming)
    const indicator =
      lane.agentName === 'mothership'
        ? mainIndicator
        : getLaneLiveIndicator({
            kind: 'subagent',
            parts: [lane.items],
            isActive: working,
            isOpen: working,
          })
    if (indicator) byLane.set(lane.id, indicator)
  }
  return { isAwaitingUser: isAwaiting, byLane }
}
