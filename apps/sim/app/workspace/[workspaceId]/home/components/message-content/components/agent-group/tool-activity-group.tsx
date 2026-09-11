'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { ActivityDisclosure } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-disclosure'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getToolIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

const MAX_SUMMARY_ACTIONS = 2

const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  read: 'read files',
  read_document: 'read documents',
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
  run_workflow: 'ran workflows',
  run_workflow_until_block: 'ran workflows',
  deploy_as_api: 'deployed workflows',
  table_rows: 'used tables',
  terminal: 'used the terminal',
  terminal_run: 'ran commands',
  terminal_input: 'sent terminal input',
  terminal_read: 'read terminal output',
  run_function: 'ran code',
  run_code: 'ran code',
  browser_navigate: 'navigated pages',
  browser_open_url: 'navigated pages',
  browser_open_tab: 'opened tabs',
  browser_switch_tab: 'switched tabs',
  browser_close_tab: 'closed tabs',
  browser_snapshot: 'read pages',
  browser_read_text: 'read pages',
  browser_extract: 'read pages',
  browser_find: 'searched pages',
  browser_click: 'clicked elements',
  browser_click_at: 'clicked elements',
  browser_drag: 'dragged elements',
  browser_type: 'entered text',
  browser_insert_text: 'entered text',
  browser_fill_form: 'filled forms',
  browser_screenshot: 'captured screenshots',
  browser_scroll: 'scrolled pages',
  browser_select_option: 'selected options',
  browser_set_checked: 'updated selections',
  open_resource: 'opened resources',
  wait: 'waited',
} as const

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
  const summary = Array.from(labels).slice(0, MAX_SUMMARY_ACTIONS).join(', ')
  const summaryLabel = summary ? summary[0].toUpperCase() + summary.slice(1) : 'Tool activity'
  const additionalActions = Math.max(0, labels.size - MAX_SUMMARY_ACTIONS)
  const outcomes = [
    failed && `${failed} failed`,
    stopped && `${stopped} stopped`,
    skipped && `${skipped} skipped`,
  ].filter(Boolean)
  return [
    additionalActions > 0 ? `${summaryLabel} +${additionalActions} more` : summaryLabel,
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
  const [expanded, setExpanded] = useState(false)
  let activeTool: ToolCallData | undefined
  for (let index = tools.length - 1; index >= 0; index--) {
    if (tools[index].status === ToolCallStatus.executing) {
      activeTool = tools[index]
      break
    }
  }
  const statusTool = activeTool ?? tools[tools.length - 1]
  const showToolHeader = Boolean(activeTool) || tools.length === 1
  const SummaryIcon = getToolIcon(tools[0].toolName)

  return (
    <ToolCallComponent
      {...statusTool}
      toolCallId={statusTool.id}
      renderStatus={(status) => (
        <ActivityDisclosure
          header={
            showToolHeader ? (
              status
            ) : (
              <ActivityStatus
                label={getToolActivitySummary(tools)}
                isActive={false}
                icon={<SummaryIcon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
              />
            )
          }
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          isStreaming={Boolean(activeTool) && autoScrollActivity}
        >
          <div className='flex min-w-0 flex-col gap-1.5 py-0.5 pl-6'>
            {tools.map((tool) => (
              <Fragment key={tool.id}>
                {tool.id === statusTool.id ? (
                  status
                ) : (
                  <ToolCallComponent {...tool} toolCallId={tool.id} />
                )}
              </Fragment>
            ))}
          </div>
        </ActivityDisclosure>
      )}
    />
  )
}
