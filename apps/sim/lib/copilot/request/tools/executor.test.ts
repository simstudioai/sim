import '@sim/testing/mocks/executor'

import { describe, expect, it } from 'vitest'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/copilot/constants'
import {
  buildToolExecutionContext,
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/copilot/request/tools/executor'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })

  it.each(['deploy_api', 'deploy_chat', 'deploy_mcp', 'redeploy', 'promote_to_live'])(
    'does not undercut deployment tool %s with the default watchdog',
    (toolName) => {
      expect(toolWatchdogTimeoutMs(toolName)).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
    }
  )
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

describe('buildToolExecutionContext', () => {
  it('threads logical tool-call identity into the handler context', () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
      sandboxProfile: 'mothership',
    }

    expect(
      buildToolExecutionContext(
        {
          id: 'call-1',
          parentToolCallId: 'parent-1',
        },
        executionContext
      )
    ).toMatchObject({
      runId: 'run-1',
      sandboxProfile: 'mothership',
      toolCallId: 'call-1',
      parentToolCallId: 'parent-1',
    })
  })

  it('isolates one tool from a sibling secret activation and merges settled provenance', () => {
    const parentRegistry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'encrypted-secret' },
    ])
    const completeSiblingActivation = parentRegistry.beginPendingActivation()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      resolvedSecretTraceRegistry: parentRegistry,
    }

    const toolContext = buildToolExecutionContext({ id: 'call-1' }, executionContext)
    const toolRegistry = toolContext.resolvedSecretTraceRegistry

    expect(toolRegistry).not.toBe(parentRegistry)
    expect(toolRegistry?.isComplete()).toBe(true)
    expect(toolRegistry?.recordResolved('TOKEN', 'secret')).toBe(true)
    parentRegistry.mergeToolCallRegistry(toolRegistry!)
    completeSiblingActivation()
    expect(parentRegistry.getActiveMatches()).toEqual([
      { plaintext: 'secret', replacement: '{{TOKEN}}' },
    ])
  })
})
