'use client'

import { type ComponentType, useId, useState } from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent } from '@sim/emcn'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { ActivityViewport } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-viewport'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getToolIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

const ACTIVITY_LABELS: Record<string, string> = {
  read: 'read files',
  glob: 'found files',
  grep: 'searched files',
  web_search: 'searched the web',
  web_fetch: 'read web pages',
  web_scrape: 'read web pages',
  search_library_docs: 'read documentation',
  search_knowledge_base: 'searched sources',
  call_integration_tool: 'used integrations',
  prepare_file_edit: 'prepared file edits',
  apply_file_edit: 'edited files',
  create_workflow: 'created workflows',
  edit_workflow: 'edited workflows',
  terminal: 'used the terminal',
  terminal_run: 'ran commands',
  terminal_input: 'sent terminal input',
  terminal_read: 'read terminal output',
  run_function: 'ran code',
  run_code: 'ran code',
  browser_navigate: 'navigated pages',
  browser_open_tab: 'opened tabs',
  browser_switch_tab: 'switched tabs',
  browser_close_tab: 'closed tabs',
  browser_snapshot: 'read pages',
  browser_read_text: 'read pages',
  browser_extract: 'read pages',
  browser_find: 'searched pages',
  browser_click: 'clicked elements',
  browser_type: 'entered text',
  browser_screenshot: 'captured screenshots',
  browser_scroll: 'scrolled pages',
  browser_select_option: 'selected options',
  browser_set_checked: 'updated selections',
  open_resource: 'opened resources',
  wait: 'waited',
}

/** Summarize completed actions without describing failed or skipped work as successful. */
export function getToolActivitySummary(tools: ToolCallData[]): string {
  if (tools.length === 1) {
    const tool = tools[0]
    return getToolStatusDisplayTitle(tool.displayTitle, tool.status, tool.toolName)
  }
  const labels = new Set<string>()
  let failed = 0
  let stopped = 0
  let skipped = 0
  for (const tool of tools) {
    if (tool.status === ToolCallStatus.success) {
      const label =
        tool.toolName === 'terminal' && tool.params?.operation === 'run'
          ? 'ran commands'
          : (ACTIVITY_LABELS[tool.toolName] ??
            (tool.toolName.startsWith('browser_') ? 'used the browser' : 'used tools'))
      labels.add(label)
    } else if (tool.status === ToolCallStatus.error) failed++
    else if (tool.status === ToolCallStatus.cancelled || tool.status === ToolCallStatus.interrupted)
      stopped++
    else if (tool.status === ToolCallStatus.skipped || tool.status === ToolCallStatus.rejected)
      skipped++
  }
  const summary = Array.from(labels).join(', ')
  const outcomes = [
    failed && `${failed} failed`,
    stopped && `${stopped} stopped`,
    skipped && `${skipped} skipped`,
  ].filter(Boolean)
  return [
    summary ? summary[0].toUpperCase() + summary.slice(1) : 'Tool activity',
    ...outcomes,
  ].join(' · ')
}

interface ToolActivityGroupProps {
  tools: ToolCallData[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  autoScrollActivity?: boolean
}

export function ToolActivityGroup({
  tools,
  ToolCallComponent,
  autoScrollActivity = true,
}: ToolActivityGroupProps) {
  const contentId = useId()
  const [expanded, setExpanded] = useState(false)
  let activeTool: ToolCallData | undefined
  for (let index = tools.length - 1; index >= 0; index--) {
    if (tools[index].status === ToolCallStatus.executing) {
      activeTool = tools[index]
      break
    }
  }
  const headerTool = activeTool ?? (tools.length === 1 ? tools[0] : undefined)
  const summary = headerTool
    ? getToolStatusDisplayTitle(headerTool.displayTitle, headerTool.status, headerTool.toolName)
    : getToolActivitySummary(tools)
  const SummaryIcon = getToolIcon(tools[0].toolName)

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <button
        type='button'
        aria-label={summary}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(!expanded)}
        className='group/agent flex w-full min-w-0 cursor-pointer items-center gap-2 text-left'
      >
        {headerTool ? (
          <ToolCallComponent key={headerTool.id} {...headerTool} toolCallId={headerTool.id} />
        ) : (
          <ActivityStatus
            label={summary}
            isActive={false}
            icon={<SummaryIcon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
          />
        )}
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-[transform,opacity] duration-150',
            !expanded &&
              '-rotate-90 opacity-0 group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent id={contentId}>
          <ActivityViewport isStreaming={Boolean(activeTool) && autoScrollActivity}>
            <div className='flex min-w-0 flex-col gap-1.5 py-0.5 pl-6'>
              {tools.map((tool) => (
                <ToolCallComponent key={tool.id} {...tool} toolCallId={tool.id} />
              ))}
            </div>
          </ActivityViewport>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
