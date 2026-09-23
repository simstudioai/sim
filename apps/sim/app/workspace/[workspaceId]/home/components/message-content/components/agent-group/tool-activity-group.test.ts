/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getToolActivitySummary } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function tool(id: string, displayTitle: string, status: ToolCallStatus = 'success'): ToolCallData {
  return { id, toolName: 'sim_cli', displayTitle, status }
}

describe('getToolActivitySummary', () => {
  it('uses the latest concrete resource action plus the remaining call count', () => {
    expect(
      getToolActivitySummary([
        tool('read', 'Reading invoice inputs'),
        tool('edit', 'Editing invoice workflow'),
        tool('run', 'Running invoice workflow'),
      ])
    ).toBe('Ran invoice workflow + 2')
  })

  it('keeps model supplied descriptions without replacing them with action categories', () => {
    expect(
      getToolActivitySummary([
        { ...tool('read', 'Reading inbox'), activityDescription: 'Read the latest inbox emails' },
      ])
    ).toBe('Read the latest inbox emails')
  })

  it('keeps failed attempts in history without naming or counting them in the summary', () => {
    expect(
      getToolActivitySummary([
        tool('read', 'Reading invoice inputs'),
        tool('failed', 'Running invoice workflow', 'error'),
        tool('rejected', 'Editing invoice workflow', 'rejected'),
      ])
    ).toBe('Read invoice inputs')
  })

  it('does not claim success when every call failed', () => {
    expect(
      getToolActivitySummary([
        tool('failed', 'Reading invoice inputs', 'error'),
        tool('rejected', 'Editing invoice workflow', 'rejected'),
      ])
    ).toBe('2 tool calls')
  })

  it('preserves a concrete custom tool name instead of a generic used tools fallback', () => {
    expect(
      getToolActivitySummary([
        { ...tool('a', 'Checking inventory'), toolName: 'custom_inventory' },
        { ...tool('b', 'Reconciled account balances'), toolName: 'custom_reconcile' },
      ])
    ).toBe('Reconciled account balances + 1')
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
        tool('failed', 'Reading file', 'error'),
        tool('stopped', 'Running checks', 'interrupted'),
        tool('skipped', 'Running checks', 'skipped'),
        tool('finished', 'Reading project notes'),
      ])
    ).toBe('Read project notes + 2 · 1 stopped · 1 skipped')
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
