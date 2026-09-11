/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getToolActivitySummary } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function tool(toolName: string, status: ToolCallStatus = 'success'): ToolCallData {
  return { id: toolName, toolName, displayTitle: `Running ${toolName}`, status }
}

describe('getToolActivitySummary', () => {
  it('caps distinct actions in order and counts the remaining categories, not repeated calls', () => {
    expect(
      getToolActivitySummary([tool('read'), tool('terminal_run'), tool('read'), tool('grep')])
    ).toBe('Read files, ran commands +1 more')
  })

  it('summarizes browser navigation and interactions without repeating actions', () => {
    expect(
      getToolActivitySummary([
        tool('browser_navigate'),
        tool('browser_read_text'),
        tool('browser_type'),
        tool('browser_navigate'),
      ])
    ).toBe('Navigated pages, read pages +1 more')
  })

  it('does not describe unsuccessful work as completed actions', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        tool('apply_file_edit', 'error'),
        tool('terminal_run', 'cancelled'),
        tool('browser_type', 'rejected'),
      ])
    ).toBe('Read files · 1 failed · 1 stopped · 1 skipped')
  })

  it('does not invent actions when all calls failed or were stopped', () => {
    expect(
      getToolActivitySummary([
        tool('apply_file_edit', 'error'),
        tool('terminal_run', 'interrupted'),
      ])
    ).toBe('Tool activity · 1 failed · 1 stopped')
  })

  it('keeps an individual tool’s descriptive title', () => {
    expect(
      getToolActivitySummary([{ ...tool('read'), displayTitle: 'Reading project notes' }])
    ).toBe('Read project notes')
  })

  it.each([
    ['skipped', 'Skipped running checks'],
    ['interrupted', 'Stopped running checks'],
  ] as const)('labels a single %s tool as finished', (status, expected) => {
    expect(
      getToolActivitySummary([{ ...tool('terminal', status), displayTitle: 'Running checks' }])
    ).toBe(expected)
  })

  it('keeps unknown tools visible with a neutral summary', () => {
    expect(getToolActivitySummary([tool('future_tool'), tool('browser_future_action')])).toBe(
      'Used tools, used the browser'
    )
  })

  it('describes current browser and workflow tools', () => {
    expect(
      getToolActivitySummary([
        tool('browser_open_url'),
        tool('browser_fill_form'),
        tool('browser_insert_text'),
        tool('read_document'),
        tool('run_workflow'),
        tool('deploy_as_api'),
        tool('table_rows'),
      ])
    ).toBe('Navigated pages, filled forms +5 more')
  })

  it('keeps failure and interruption counts visible when action categories are capped', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        tool('grep'),
        tool('terminal'),
        tool('browser_navigate'),
        tool('apply_file_edit', 'error'),
        tool('wait', 'interrupted'),
        tool('browser_type', 'skipped'),
      ])
    ).toBe('Read files, searched files +2 more · 1 failed · 1 stopped · 1 skipped')
  })

  it('describes terminal runs from their operation', () => {
    expect(
      getToolActivitySummary([{ ...tool('terminal'), params: { operation: 'run' } }, tool('read')])
    ).toBe('Ran commands, read files')
  })
})
