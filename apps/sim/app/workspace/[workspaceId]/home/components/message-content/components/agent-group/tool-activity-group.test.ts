/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getCompletedActivityLabel } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** A finished activity without a model title is labelled by its action summary. */
function getToolActivitySummary(tools: ToolCallData[]): string {
  return getCompletedActivityLabel(tools, undefined)
}

let toolSeq = 0

function tool(
  toolName: string,
  displayTitle: string,
  status: ToolCallStatus = 'success',
  params?: Record<string, unknown>
): ToolCallData {
  toolSeq += 1
  return { id: `tool-${toolSeq}`, toolName, displayTitle, status, params }
}

describe('getToolActivitySummary', () => {
  it('names the first three distinct CLI actions without counting the rest', () => {
    expect(
      getToolActivitySummary([
        tool('cli_tables_list', 'Listed tables'),
        tool('cli_tables_get', 'Read Invoices'),
        tool('cli_tables_get', 'Read Customers'),
        tool('cli_files_read', 'Read notes.md'),
        tool('cli_workflows_run', 'Ran invoice workflow'),
      ])
    ).toBe('Listed, read tables, read files')
  })

  it('shares one object across adjacent browser actions', () => {
    expect(
      getToolActivitySummary([
        tool('browser_navigate', 'Opened example.com'),
        tool('browser_read_text', 'Read page'),
        tool('browser_click', 'Clicked Sign in'),
        tool('browser_screenshot', 'Took screenshot'),
      ])
    ).toBe('Navigated, read pages, clicked elements')
  })

  it('collapses repeated actions so a long run cannot crowd out other kinds', () => {
    expect(
      getToolActivitySummary([
        tool('web_search', 'Searched online for pricing'),
        tool('web_search', 'Searched online for plans'),
        tool('web_fetch', 'Fetched pricing page'),
        tool('run_code', 'Ran code'),
      ])
    ).toBe('Searched the web, read web pages, ran code')
  })

  it('keeps two phrases when only two distinct actions succeeded', () => {
    expect(
      getToolActivitySummary([
        tool('cli_workflows_get', 'Read invoice workflow'),
        tool('cli_workflows_operations_apply', 'Edited invoice workflow'),
      ])
    ).toBe('Read, edited workflows')
  })

  it('keeps failed attempts in history without naming or counting them in the summary', () => {
    const summary = getToolActivitySummary([
      tool('web_search', 'Searched online for invoices'),
      tool('browser_navigate', 'Opening billing portal', 'error'),
      tool('cli_tables_rows_update', 'Updating table row', 'rejected'),
      tool('read', 'Read invoice inputs'),
    ])
    expect(summary).toBe('Searched the web, read files')
    expect(summary).not.toMatch(/\+\s?\d/)
  })

  it('does not claim success when every call failed', () => {
    expect(
      getToolActivitySummary([
        tool('read', 'Reading invoice inputs', 'error'),
        tool('edit_workflow', 'Editing invoice workflow', 'rejected'),
      ])
    ).toBe('2 tool calls')
  })

  it('describes custom and unnamed CLI calls with their own completed titles', () => {
    expect(
      getToolActivitySummary([
        tool('custom_inventory', 'Checked inventory'),
        tool('sim_cli', 'Reconciled account balances'),
      ])
    ).toBe('Checked inventory, reconciled account balances')
  })

  it('keeps a single call title and its model supplied description', () => {
    expect(getToolActivitySummary([tool('cli_tables_list', 'Listed tables')])).toBe('Listed tables')
    expect(
      getToolActivitySummary([
        { ...tool('read', 'Reading inbox'), activityDescription: 'Read the latest inbox emails' },
      ])
    ).toBe('Read the latest inbox emails')
  })
})

describe('interrupted activity summaries', () => {
  it.each([
    ['rejected', 'Running checks'],
    ['skipped', 'Skipped running checks'],
    ['interrupted', 'Stopped running checks'],
  ] as const)('labels a single %s tool as finished', (status, expected) => {
    expect(getToolActivitySummary([tool('terminal', 'Running checks', status)])).toBe(expected)
  })

  it('keeps earlier interruption counts without naming failed calls', () => {
    expect(
      getToolActivitySummary([
        tool('read', 'Reading file', 'error'),
        tool('terminal', 'Running checks', 'interrupted', { operation: 'run' }),
        tool('terminal', 'Running checks', 'skipped', { operation: 'run' }),
        tool('read', 'Read project notes'),
      ])
    ).toBe('Read project notes · 1 stopped · 1 skipped')
  })

  it('does not infer tool failures from workflow results', () => {
    expect(
      getToolActivitySummary([
        {
          ...tool('run_workflow', 'Running invoice workflow'),
          result: { success: false, error: 'Workflow run failed' },
        },
      ])
    ).toBe('Ran invoice workflow')
  })
})
