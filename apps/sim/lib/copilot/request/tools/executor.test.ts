import '@sim/testing/mocks/executor'

import { describe, expect, it } from 'vitest'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/copilot/constants'
import {
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/copilot/request/tools/executor'

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })
})

describe('pendingToolWaitBudgetMs', () => {
  it('waits on a person for as long as the whole turn allows', () => {
    // The 60s default would force-fail a permission prompt while the user was
    // still reading it, resuming Go before they ever answered.
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'awaiting_approval' })).toBe(
      TOOL_WATCHDOG_LONG_RUNNING_MS
    )
  })

  it('falls back to the tool\u2019s own watchdog once it is actually executing', () => {
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'executing' })).toBe(
      TOOL_WATCHDOG_DEFAULT_MS
    )
  })
})
