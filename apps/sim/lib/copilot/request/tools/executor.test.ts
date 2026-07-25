import '@sim/testing/mocks/executor'

import { describe, expect, it } from 'vitest'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/copilot/constants'
import { toolWatchdogTimeoutMs } from '@/lib/copilot/request/tools/executor'

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })
})
