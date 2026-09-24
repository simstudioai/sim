'use client'

import { type ComponentType, type ReactNode, useState } from 'react'
import { ActivityTextColumn } from '@/components/ui/activity-status'
import { ThinkingLoader } from '@/components/ui/thinking-loader'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/mothership/tools/retired-tools'
import { readToolActivity } from '@/lib/mothership/tools/tool-activity'
import { getToolDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import {
  collectGroupTools,
  hasAgentGroupItemContent,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import { BrowserAgentIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/browser-agent-icon'
import { renderInlineMarkdown } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/inline-markdown'
import {
  getActiveBrowserTakeover,
  getLaneLiveIndicator,
  hasPendingInteraction,
  isLaneWorking,
  type LaneLiveIndicator,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import { MainAgentActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/main-agent-activity'
import {
  getActivityHeaderTool,
  getActivityStatusTool,
  getCompletedActivityLabel,
  getInProgressActivityLabel,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { useToolCallTitle } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-title'
import {
  getActivityAttentionKey,
  needsToolInput,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import {
  getAgentIcon,
  isToolDone,
} from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { useSmoothText } from '@/hooks/use-smooth-text'

/**
 * A subagent group nested inside another agent's output. Carries the same shape
 * as a top-level group so {@link AgentGroupView} can render it recursively, which is
 * how deterministic parent/child nesting (e.g. Deploy inside Workflow) is drawn.
 */
export interface NestedAgentGroup {
  error?: string
  id: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating: boolean
  isOpen: boolean
}

export type AgentGroupItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; data: ToolCallData }
  | { type: 'agent_group'; group: NestedAgentGroup }

export interface AgentGroupProps {
  activity?: ToolActivity
  error?: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  /** This lane can receive work; main lanes close when a later transcript segment begins. */
  isLaneOpen?: boolean
  /** Opens a subagent group on first render. */
  defaultExpanded?: boolean
  /** Follows incoming activity until the user scrolls up. */
  autoScrollActivity?: boolean
  /**
   * The live indicator this lane shares with its turn, decided once for the
   * whole turn. A root lane rendered on its own leaves it undefined and
   * decides it from its own items; `null` means the lane has none.
   */
  liveIndicator?: LaneLiveIndicator | null
}

/** True when a nested group owns a browser hand-back question. */
function hasNestedBrowserTakeover(items: AgentGroupItem[]): boolean {
  return items.some(
    (item) =>
      item.type === 'agent_group' &&
      item.group.isOpen &&
      (getActiveBrowserTakeover(item.group.items) !== null ||
        hasNestedBrowserTakeover(item.group.items))
  )
}

interface AgentGroupViewProps extends AgentGroupProps {
  /** Supplies tool behavior without coupling the group layout to the block registry. */
  ToolCallComponent: ComponentType<ToolCallItemProps>
  renderBrowserTakeover?: (reason: string) => ReactNode
}

export function AgentGroupView({
  agentName,
  agentLabel,
  activity: groupActivity,
  error,
  items,
  isDelegating = false,
  isStreaming = false,
  isLaneOpen = false,
  defaultExpanded = false,
  autoScrollActivity = true,
  ToolCallComponent,
  renderBrowserTakeover,
  liveIndicator,
}: AgentGroupViewProps) {
  const AgentIcon = getAgentIcon(agentName)
  const isMainAgent = agentName === 'mothership'
  const tools = isMainAgent ? [] : collectGroupTools(items)
  const statusTool = getActivityStatusTool(tools)
  const headerTool = statusTool && getActivityHeaderTool(tools, statusTool)
  const headerTitle = useToolCallTitle(
    headerTool && {
      ...headerTool,
      toolCallId: headerTool.id,
      displayTitle:
        headerTool.displayTitle ||
        getToolDisplayTitle(String(headerTool.toolName ?? ''), undefined),
    }
  )
  const activityDescriptor =
    groupActivity ??
    tools
      .map((tool) => readToolActivity(tool.params, tool.streamingArgs))
      .reverse()
      .find((entry) => entry?.title || entry?.completedTitle)
  const browserAgentAvailable = isBrowserAgentAvailable()
  const activeBrowserTakeover =
    browserAgentAvailable && isLaneOpen ? getActiveBrowserTakeover(items) : null
  const nestedBrowserTakeover = browserAgentAvailable && hasNestedBrowserTakeover(items)
  const isWorking =
    !activeBrowserTakeover &&
    isLaneWorking({ error, isDelegating, isOpen: isLaneOpen, items }, isStreaming)

  const [manualExpanded, setManualExpanded] = useState(defaultExpanded)
  const [expandedTakeoverId, setExpandedTakeoverId] = useState<string | null>(null)
  const pendingInteraction = hasPendingInteraction(items)
  /** Blocking interactions override manual collapse so the user can resume the turn. */
  const expanded =
    pendingInteraction ||
    nestedBrowserTakeover ||
    (activeBrowserTakeover ? expandedTakeoverId === activeBrowserTakeover.id : manualExpanded)

  const live =
    liveIndicator !== undefined
      ? liveIndicator
      : getLaneLiveIndicator(
          isMainAgent
            ? {
                kind: 'main',
                parts: [items],
                isActive: isStreaming,
                isOpen: isStreaming && isLaneOpen,
              }
            : {
                kind: 'subagent',
                parts: [items],
                isActive: isStreaming && isWorking,
                isOpen: isStreaming && isWorking,
              }
        )
  const liveCall = live?.type === 'call' ? live.tool : undefined
  /** This lane's subtree holds the live indicator: its narration header, or its live call. */
  const isLaneLive =
    !error &&
    (live?.type === 'narration' ||
      (liveCall !== undefined && tools.some((tool) => tool.id === liveCall.id)))
  /**
   * The nested lanes still working, which show their own header. One that has
   * ended hands its last call back to this lane's header.
   */
  const workingNestedLanes = items.flatMap((item) =>
    item.type === 'agent_group' && isLaneWorking(item.group, isStreaming) ? [item.group] : []
  )
  /** An expanded lane defers to a visible, still-working nested lane holding the live call. */
  const liveInNestedLane =
    liveCall !== undefined &&
    workingNestedLanes.some((lane) =>
      collectGroupTools(lane.items).some((tool) => tool.id === liveCall.id)
    )
  const headerActive = isLaneLive && !(expanded && liveInNestedLane)
  /**
   * Tense follows liveness: a live lane, or a working lane whose status call
   * still runs, reads in progress. An ended lane reads as finished even when a
   * stale call was never closed.
   */
  const inProgress =
    isLaneLive || (isWorking && statusTool !== undefined && !isToolDone(statusTool.status))
  const agentIcon =
    headerActive && !statusTool ? (
      <ThinkingLoader size={14} startVariant='corners' />
    ) : agentName === 'browser' ? (
      <BrowserAgentIcon items={items} />
    ) : (
      <AgentIcon className='size-full' />
    )

  const meaningfulItems = items.filter(hasAgentGroupItemContent)
  if (meaningfulItems.length === 0 && !error) return null

  const toggleExpanded = () => {
    if (activeBrowserTakeover) {
      setExpandedTakeoverId(expanded ? null : activeBrowserTakeover.id)
      return
    }
    setManualExpanded(!expanded)
  }

  /**
   * Main lanes hold only calls, so every nested lane and narration row here
   * belongs to a subagent lane and sits in its text column: indentation means
   * nested work.
   */
  const renderItem = (item: AgentGroupItem, idx: number) => {
    if (item.type === 'tool') {
      return (
        <ToolCallComponent
          key={item.data.id}
          toolCallId={item.data.id}
          toolName={item.data.toolName}
          displayTitle={item.data.displayTitle}
          activityDescription={item.data.activityDescription}
          status={item.data.status}
          params={item.data.params}
          result={item.data.result}
          streamingArgs={item.data.streamingArgs}
          startedAt={item.data.startedAt}
        />
      )
    }
    if (item.type === 'agent_group') {
      return (
        <ActivityTextColumn key={item.group.id}>
          <AgentGroupView
            ToolCallComponent={ToolCallComponent}
            renderBrowserTakeover={renderBrowserTakeover}
            agentName={item.group.agentName}
            agentLabel={item.group.agentLabel}
            items={item.group.items}
            isDelegating={item.group.isDelegating}
            isStreaming={isStreaming}
            isLaneOpen={item.group.isOpen}
            error={item.group.error}
            autoScrollActivity={autoScrollActivity}
            liveIndicator={liveCall && workingNestedLanes.includes(item.group) ? live : null}
          />
        </ActivityTextColumn>
      )
    }
    if (!item.content.trim()) return null
    return (
      <ActivityTextColumn key={`text-${idx}`}>
        <NarrationText
          content={item.content}
          isStreaming={isStreaming && idx === items.length - 1}
        />
      </ActivityTextColumn>
    )
  }

  const activity = isMainAgent ? (
    <MainAgentActivity
      activity={groupActivity}
      items={items}
      ToolCallComponent={ToolCallComponent}
      renderItem={renderItem}
      autoScrollActivity={autoScrollActivity}
      liveToolId={liveCall?.id}
    />
  ) : (
    <div className='flex min-w-0 flex-col gap-1.5 py-0.5'>{items.map(renderItem)}</div>
  )
  const headerText = error
    ? agentLabel
    : inProgress
      ? headerTool && headerTitle
        ? getInProgressActivityLabel(
            headerTitle.activeLabel,
            headerTool,
            tools,
            activityDescriptor?.title
          )
        : 'Thinking'
      : tools.length > 0
        ? getCompletedActivityLabel(tools, activityDescriptor)
        : agentLabel
  const collapsible =
    meaningfulItems.length > 1 ||
    meaningfulItems.some(
      (item) =>
        item.type !== 'tool' ||
        item.data.status === ToolCallStatus.error ||
        item.data.status === ToolCallStatus.rejected ||
        needsToolInput(item.data) ||
        item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID
    )

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {isMainAgent ? (
        activity
      ) : (
        <ActivityStream
          activity={{ label: headerText, isActive: headerActive, icon: agentIcon }}
          activityKey={headerTool?.id}
          expandedLabel={pendingInteraction ? undefined : activityDescriptor?.title}
          attentionKey={`${getActivityAttentionKey(tools)}:${activeBrowserTakeover?.id ?? ''}`}
          collapsible={collapsible}
          expanded={expanded}
          onToggle={toggleExpanded}
          isStreaming={isStreaming && autoScrollActivity}
          unbounded={pendingInteraction || nestedBrowserTakeover}
        >
          {activity}
        </ActivityStream>
      )}
      {error && (
        <ActivityTextColumn>
          <p className='text-[var(--text-tertiary)] text-caption'>{error}</p>
        </ActivityTextColumn>
      )}
      {activeBrowserTakeover && (
        <div key={activeBrowserTakeover.id} className='animate-stream-fade-in'>
          {renderBrowserTakeover?.(activeBrowserTakeover.reason)}
        </div>
      )}
    </div>
  )
}

interface NarrationTextProps {
  content: string
  /** This row is the group's live tail — pace its reveal like top-level text. */
  isStreaming: boolean
}

/**
 * A narration row inside an agent group. The live tail row is
 * paced with {@link useSmoothText} so streamed chunks reveal word-by-word
 * instead of popping in, matching the top-level text treatment.
 */
function NarrationText({ content, isStreaming }: NarrationTextProps) {
  const revealed = useSmoothText(content, isStreaming)

  return (
    <span className='text-[var(--text-tertiary)] text-base leading-5'>
      {renderInlineMarkdown(revealed.trim())}
    </span>
  )
}
