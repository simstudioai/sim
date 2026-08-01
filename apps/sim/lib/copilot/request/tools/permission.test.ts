/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TraceCollector } from '@/lib/copilot/request/trace'

const { toolRequiresApproval, waitForToolPermissionDecision } = vi.hoisted(() => ({
  toolRequiresApproval: vi.fn().mockReturnValue(true),
  waitForToolPermissionDecision: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  toolRequiresApproval,
  isSimExecuted: vi.fn().mockReturnValue(true),
  getToolEntry: vi.fn().mockReturnValue(undefined),
  executeTool: vi.fn(),
  ensureHandlersRegistered: vi.fn(),
}))

vi.mock('@/lib/copilot/persistence/tool-permission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/copilot/persistence/tool-permission')>()
  return { ...actual, waitForToolPermissionDecision }
})

import { MothershipStreamV1ToolExecutor } from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import {
  runGatedToolExecution,
  toolCallNeedsApproval,
} from '@/lib/copilot/request/tools/permission'
import type { StreamEvent, ToolCallState } from '@/lib/copilot/request/types'

function makeContext() {
  const context = createStreamingContext({ runId: 'run-1' })
  context.toolPermissions = { enabled: true, autoAllowed: new Set() }
  context.trace = new TraceCollector()
  return context
}

function makeToolCall(): ToolCallState {
  return {
    id: 'call-1',
    name: 'terminal',
    status: 'pending',
    params: { operation: 'run', args: { command: 'ls' } },
  }
}

function gate(
  context: ReturnType<typeof makeContext>,
  toolCall: ToolCallState,
  execute: () => Promise<{ status: string }> | null,
  events: StreamEvent[]
) {
  return runGatedToolExecution(
    toolCall,
    toolCall.id,
    toolCall.name,
    toolCall.params,
    MothershipStreamV1ToolExecutor.client,
    context,
    {
      onEvent: (event) => {
        events.push(event)
      },
    },
    execute as () => Promise<never>
  )
}

describe('toolCallNeedsApproval', () => {
  const runCall = { operation: 'run', args: { command: 'ls' } }

  it('gates a tool the catalog marks as requiring approval', () => {
    expect(toolCallNeedsApproval('terminal', makeContext(), {}, false, runCall)).toBe(true)
  })

  it('does not gate terminal operations that only look at the screen', () => {
    // The catalog flag is per tool, but a card for every `read` would train
    // the user to click through the ones that matter.
    const context = makeContext()
    for (const operation of ['read', 'list', 'cwd', 'panes']) {
      expect(toolCallNeedsApproval('terminal', context, {}, false, { operation })).toBe(false)
    }
  })

  it('does not gate a tool the user already always-allowed', () => {
    const context = makeContext()
    context.toolPermissions.autoAllowed.add('terminal')
    expect(toolCallNeedsApproval('terminal', context, {}, false, runCall)).toBe(false)
  })

  it('never gates a non-interactive run, which has nobody to answer the prompt', () => {
    expect(
      toolCallNeedsApproval('terminal', makeContext(), { interactive: false }, false, runCall)
    ).toBe(false)
  })

  it('does not gate when the surface has the gate turned off', () => {
    const context = makeContext()
    context.toolPermissions.enabled = false
    expect(toolCallNeedsApproval('terminal', context, {}, false, runCall)).toBe(false)
  })

  it('gates a resolved integration operation off the frame Go stamped', () => {
    // gmail_read_v2 is request-local: it is not in the catalog at all, so the
    // only thing marking it is the awaiting_approval status on the frame.
    toolRequiresApproval.mockReturnValue(false)
    expect(toolCallNeedsApproval('gmail_read_v2', makeContext(), {}, true)).toBe(true)
  })

  it('still honors always-allow for a frame-stamped integration operation', () => {
    toolRequiresApproval.mockReturnValue(false)
    const context = makeContext()
    context.toolPermissions.autoAllowed.add('gmail_read_v2')
    expect(toolCallNeedsApproval('gmail_read_v2', context, {}, true)).toBe(false)
  })
})

describe('gated tools are askable', () => {
  it('every tool requiring approval renders a row the user can answer on', async () => {
    // A gated tool with no visible row cannot be consented to. The runtime
    // refuses to run such a call, so shipping one would silently disable the
    // tool; this keeps the catalog honest instead.
    const { TOOL_CATALOG } = await vi.importActual<
      typeof import('@/lib/copilot/generated/tool-catalog-v1')
    >('@/lib/copilot/generated/tool-catalog-v1')
    const { getHiddenToolNames } = await vi.importActual<
      typeof import('@/lib/copilot/tools/client/hidden-tools')
    >('@/lib/copilot/tools/client/hidden-tools')

    const hidden = getHiddenToolNames()
    const unaskable = Object.entries(TOOL_CATALOG)
      .filter(([name, entry]) => entry.requiresApproval && (entry.internal || hidden.has(name)))
      .map(([name]) => name)

    expect(unaskable).toEqual([])
  })

  it('never marks a go-routed tool as requiring approval', async () => {
    // Go executes these in-process and streams back a result; the call never
    // reaches Sim's dispatch, so this gate has nothing to hold. Marking one
    // would draw a permission card for work that already ran.
    //
    // call_integration_tool is the one exception, and only nominally: the
    // catalog describes the gateway as go/sync, but at runtime Go resolves the
    // operation and hands it to Sim on a checkpoint, stamping the frame with
    // awaiting_approval. It is gated on that stamp, under the resolved
    // operation's name, never under this one.
    const { TOOL_CATALOG } = await vi.importActual<
      typeof import('@/lib/copilot/generated/tool-catalog-v1')
    >('@/lib/copilot/generated/tool-catalog-v1')

    const ungatable = Object.entries(TOOL_CATALOG)
      .filter(
        ([name, entry]) =>
          entry.requiresApproval && entry.route === 'go' && name !== 'call_integration_tool'
      )
      .map(([name]) => name)

    expect(ungatable).toEqual([])
  })

  it('gates the tools we intend to gate', async () => {
    const { TOOL_CATALOG } = await vi.importActual<
      typeof import('@/lib/copilot/generated/tool-catalog-v1')
    >('@/lib/copilot/generated/tool-catalog-v1')

    expect(
      Object.entries(TOOL_CATALOG)
        .filter(([, entry]) => entry.requiresApproval)
        .map(([name]) => name)
        .sort()
    ).toEqual([
      'call_integration_tool',
      'delete_workspace_mcp_server',
      'deploy_api',
      'deploy_chat',
      'deploy_mcp',
      'function_execute',
      'promote_to_live',
      'redeploy',
      'run_code',
      'run_workflow',
      'run_workflow_until_block',
      'terminal',
    ])
  })
})

describe('runGatedToolExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toolRequiresApproval.mockReturnValue(true)
  })

  it('does not execute the tool until the user has answered', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const execute = vi.fn().mockResolvedValue({ status: 'success' })

    let answer: (value: unknown) => void = () => {}
    waitForToolPermissionDecision.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )

    const pending = gate(context, toolCall, execute, [])

    // The decision is outstanding: nothing ran, and the promise the resume gate
    // waits on has not settled.
    await Promise.resolve()
    expect(execute).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('awaiting_approval')

    answer({ toolCallId: 'call-1', decision: 'allow' })
    await pending
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('stays unsettled across the execution so the resume cannot run early', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    let finishExecution: (value: { status: string }) => void = () => {}
    const execute = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishExecution = resolve
      })
    )
    waitForToolPermissionDecision.mockResolvedValue({ toolCallId: 'call-1', decision: 'allow' })

    const pending = gate(context, toolCall, execute, [])
    let settled = false
    void pending.then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    expect(settled).toBe(false)

    finishExecution({ status: 'success' })
    await pending
    expect(settled).toBe(true)
  })

  it('reports a skip as a successful skipped result so the model adapts', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const execute = vi.fn()
    const events: StreamEvent[] = []
    waitForToolPermissionDecision.mockResolvedValue({ toolCallId: 'call-1', decision: 'skip' })

    const signal = await gate(context, toolCall, execute, events)

    expect(execute).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('skipped')
    // Success keeps Go's consecutive-tool-failure breaker from counting a
    // deliberate user decision as a malfunction.
    expect(signal.status).toBe('success')
    expect(toolCall.result).toMatchObject({ success: true })

    const result = events.find((event) => event.payload?.phase === 'result')
    expect(result?.payload).toMatchObject({ status: 'skipped', success: true })
    expect(result?.payload?.output).toMatchObject({ skipped: true, reason: 'user_declined' })
  })

  it('treats allow-for-this-chat as an allow that also stops re-prompting', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const execute = vi.fn().mockResolvedValue({ status: 'success' })
    waitForToolPermissionDecision.mockResolvedValue({
      toolCallId: 'call-1',
      decision: 'allow_chat',
    })

    await gate(context, toolCall, execute, [])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(context.toolPermissions.autoAllowed.has('terminal')).toBe(true)
  })

  it('does not suppress later prompts for a one-off allow', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    waitForToolPermissionDecision.mockResolvedValue({ toolCallId: 'call-1', decision: 'allow' })

    await gate(context, toolCall, () => Promise.resolve({ status: 'success' }), [])

    expect(context.toolPermissions.autoAllowed.has('terminal')).toBe(false)
    expect(toolCallNeedsApproval('terminal', context, {}, false, { operation: 'run' })).toBe(true)
  })

  it('remembers always-allow for the rest of the turn', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    waitForToolPermissionDecision.mockResolvedValue({
      toolCallId: 'call-1',
      decision: 'always_allow',
    })

    await gate(context, toolCall, () => Promise.resolve({ status: 'success' }), [])

    expect(context.toolPermissions.autoAllowed.has('terminal')).toBe(true)
    expect(toolCallNeedsApproval('terminal', context, {}, false, { operation: 'run' })).toBe(false)
  })

  it('cancels rather than runs when the prompt is never answered', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const execute = vi.fn()
    waitForToolPermissionDecision.mockResolvedValue(null)

    const signal = await gate(context, toolCall, execute, [])

    expect(execute).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('cancelled')
    expect(signal.status).toBe('error')
  })

  it('refuses to run a gated tool whose row is hidden, rather than hanging the turn', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const execute = vi.fn()
    waitForToolPermissionDecision.mockResolvedValue({ toolCallId: 'call-1', decision: 'allow' })

    const signal = await runGatedToolExecution(
      toolCall,
      toolCall.id,
      toolCall.name,
      toolCall.params,
      MothershipStreamV1ToolExecutor.client,
      context,
      {},
      execute as () => Promise<never>,
      false
    )

    expect(waitForToolPermissionDecision).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('skipped')
    expect(signal.status).toBe('success')
    expect(toolCall.result?.output).toMatchObject({ reason: 'no_prompt_surface' })
  })

  it('turns the row back into a running one once allowed', async () => {
    const context = makeContext()
    const toolCall = makeToolCall()
    const events: StreamEvent[] = []
    waitForToolPermissionDecision.mockResolvedValue({ toolCallId: 'call-1', decision: 'allow' })

    await gate(context, toolCall, () => Promise.resolve({ status: 'success' }), events)

    const call = events.find((event) => event.payload?.phase === 'call')
    expect(call?.payload).toMatchObject({ status: 'executing', toolCallId: 'call-1' })
  })
})
