/**
 * @vitest-environment node
 */
import { workspace } from '@sim/db/schema'
import { queueTableRows } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import '@sim/testing/mocks/executor'

import { trace } from '@opentelemetry/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeTool,
  dispatchCli,
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
  claimSimToolExecution,
  settleSimToolExecution,
  waitForToolConfirmation,
  onEvent,
  recordSimToolMetric,
  setAttribute,
  withCopilotToolSpan,
  encryptSecret,
  decryptSecret,
  publishToolConfirmation,
  replaceTerminalAsyncToolCallResult,
  mockError,
} = vi.hoisted(() => {
  const setAttribute = vi.fn()
  return {
    executeTool: vi.fn(),
    dispatchCli: vi.fn(),
    encryptSecret: vi.fn(),
    decryptSecret: vi.fn(),
    publishToolConfirmation: vi.fn(),
    waitForToolConfirmation: vi.fn(),
    replaceTerminalAsyncToolCallResult: vi.fn(),
    mockError: vi.fn(),
    completeAsyncToolCall: vi.fn(),
    markAsyncToolRunning: vi.fn(),
    upsertAsyncToolCall: vi.fn(),
    claimSimToolExecution: vi.fn(),
    settleSimToolExecution: vi.fn(),
    onEvent: vi.fn(),
    recordSimToolMetric: vi.fn(),
    setAttribute,
    withCopilotToolSpan: vi.fn(
      (_input: unknown, fn: (span: { setAttribute: typeof setAttribute }) => Promise<unknown>) =>
        fn({ setAttribute })
    ),
  }
})

vi.mock('@/lib/api/server/routes/in-process-transport', () => ({
  dispatchInProcessV2Request: dispatchCli,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: async () => 'read',
  permissionSatisfies: (actual: string | null, required: string) => actual === required,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mockError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret, decryptSecret }))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getTrustedWorkflowToolExecution: vi.fn(),
}))

vi.mock('@/lib/mothership/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
  executeTool,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  completeAsyncToolCall,
  completeOwnedSimToolCall: completeAsyncToolCall,
  renewSimToolExecutionLease: vi.fn().mockResolvedValue(true),
  markAsyncToolRunning,
  upsertAsyncToolCall,
  replaceTerminalAsyncToolCallResult,
  claimSimToolExecution,
  settleSimToolExecution,
}))

vi.mock('@/lib/mothership/persistence/tool-confirm', () => ({
  publishToolConfirmation,
  waitForToolConfirmation,
}))

vi.mock('@/lib/mothership/request/metrics', () => ({
  recordSimToolMetric,
}))

vi.mock('@/lib/mothership/request/otel', () => ({
  withCopilotToolSpan,
  withCopilotSpan: (_name: string, _attrs: unknown, fn: () => Promise<unknown>) => fn(),
  getCopilotTracer: () => trace.getTracer('test-copilot'),
}))

vi.mock('@/lib/mothership/request/sse-utils', () => ({
  markToolResultSeen: vi.fn(),
}))

vi.mock('@/lib/mothership/request/tools/files', () => ({
  maybeWriteOutputToFile: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/mothership/request/tools/resources', () => ({
  handleResourceSideEffects: vi.fn(),
}))

vi.mock('@/lib/mothership/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/mothership/request/tools/workflow-context', () => ({
  applyCreateWorkflowOutputToContext: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/delegation', () => ({
  mintDelegationToken: async () => 'local-cli-budget-fixture',
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getInternalApiBaseUrl: () => 'https://cli-budget.test',
  SITE_URL: 'https://cli-budget.test',
}))

import { AsyncToolCallOwnershipError } from '@/lib/mothership/async-runs/errors'
import { SimToolExecutionLeaseLostError } from '@/lib/mothership/async-runs/execution-lease'
import type { AsyncConfirmationState } from '@/lib/mothership/async-runs/lifecycle'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/mothership/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { GenerateApiKey } from '@/lib/mothership/generated/tool-catalog-v1'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { handleClientCompletion } from '@/lib/mothership/request/handlers/types'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import {
  sealClientToolCompletion,
  sealClientToolContext,
} from '@/lib/mothership/request/tools/client-completion-seal.server'
import {
  buildToolExecutionContext,
  executeToolAndReport,
  failPendingToolCall,
  pendingToolWaitBudgetMs,
  toolWatchdogTimeoutMs,
} from '@/lib/mothership/request/tools/executor'
import { maybeWriteOutputToFile } from '@/lib/mothership/request/tools/files'
import { handleResourceSideEffects } from '@/lib/mothership/request/tools/resources'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/mothership/request/tools/tables'
import type { ExecutionContext, ToolCallState } from '@/lib/mothership/request/types'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function buildStreamingContext(toolCall: ToolCallState) {
  return createStreamingContext({
    runId: 'run-1',
    messageId: 'message-1',
    toolCalls: new Map([[toolCall.id, toolCall]]),
  })
}

function buildPendingToolCall(): ToolCallState {
  return {
    id: 'tool-call-1',
    name: 'test_tool',
    status: 'pending',
    params: {},
  }
}

describe('tool result size diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completeAsyncToolCall.mockResolvedValue(null)
    markAsyncToolRunning.mockResolvedValue(null)
    upsertAsyncToolCall.mockResolvedValue(null)
    claimSimToolExecution.mockResolvedValue({ outcome: 'claimed' })
    settleSimToolExecution.mockResolvedValue(undefined)
  })

  it.each(['workspace-a', 'workspace-b'])(
    'publishes an organization file edit under its own %s target',
    async (workspaceId) => {
      const output = { fileId: 'file', fileName: 'report.csv' }
      executeTool.mockResolvedValueOnce({ success: true, output })
      const toolCall = {
        ...buildPendingToolCall(),
        name: 'apply_file_edit',
        targetWorkspaceId: workspaceId,
      }
      const completion = await executeToolAndReport(
        toolCall.id,
        buildStreamingContext(toolCall),
        {
          userId: 'actor',
          organizationId: 'org',
          chatId: 'chat',
        },
        { onEvent }
      )
      expect(completion.status).toBe('success')
      expect(handleResourceSideEffects).toHaveBeenCalledWith(
        'apply_file_edit',
        {},
        expect.objectContaining({ output }),
        expect.objectContaining({ success: true }),
        'chat',
        onEvent,
        expect.any(Function),
        workspaceId,
        'actor'
      )
    }
  )
  it('keeps large visual observations out of UI replay while preserving the model result', async () => {
    const data = Buffer.alloc(850_000, 1).toString('base64')
    const output = {
      exitCode: 0,
      stdout: JSON.stringify({ name: 'manual.png', representation: 'visual' }),
      stderr: '',
      observations: [{ name: 'manual.png', mediaType: 'image/png', data }],
    }
    executeTool.mockResolvedValueOnce({ success: true, output })
    const toolCall = { ...buildPendingToolCall(), name: 'cli_files_read', execName: 'sim_cli' }
    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      },
      { onEvent }
    )
    expect(completion.status).toBe(MothershipStreamV1ToolOutcome.success)
    expect(completion.data).toEqual(output)
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ result: output }),
      expect.any(String)
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          success: true,
          output: { ...output, observations: [{ name: 'manual.png', mediaType: 'image/png' }] },
        }),
      })
    )
    expect(Buffer.byteLength(JSON.stringify(onEvent.mock.calls))).toBeLessThan(10_000)
  })

  it.each(['é🔎', { content: 'é🔎' }])(
    'records UTF-8 bytes after result projection for %j',
    async (output) => {
      executeTool.mockResolvedValueOnce({ success: true, output })
      const toolCall = buildPendingToolCall()
      const context = buildStreamingContext(toolCall)
      const endSpan = vi.spyOn(context.trace, 'endSpan')

      const completion = await executeToolAndReport(toolCall.id, context, {
        userId: 'user-1',
        workflowId: 'workflow-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      })

      expect(completion.status).toBe(MothershipStreamV1ToolOutcome.success)
      const serialized =
        typeof completion.data === 'string' ? completion.data : JSON.stringify(completion.data)
      expect(endSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tool.execute',
          attributes: expect.objectContaining({ outputBytes: Buffer.byteLength(serialized) }),
        }),
        'ok'
      )
    }
  )
})

describe('toolWatchdogTimeoutMs', () => {
  it('gives request-scoped MCP tools the long-running watchdog', () => {
    expect(toolWatchdogTimeoutMs('mcp-363de040-web_search_exa')).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })

  it('keeps ordinary tools on the strict default watchdog', () => {
    expect(toolWatchdogTimeoutMs('read')).toBe(TOOL_WATCHDOG_DEFAULT_MS)
  })

  // The Go-era deploy_* tools left the live surface with the TS worker (deploys go
  // through the CLI now); the long-running set tracks tools that can actually execute.
  it.each(['sim_cli', 'run_workflow', 'run_code', 'generate_video', 'apply_file_edit'])(
    'does not undercut long-running live tool %s with the default watchdog',
    (toolName) => {
      expect(toolWatchdogTimeoutMs(toolName)).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
    }
  )
})

describe('pendingToolWaitBudgetMs', () => {
  it('uses the executable identity for displayed CLI calls', () => {
    expect(
      pendingToolWaitBudgetMs({
        name: 'cli_workflows_run',
        execName: 'sim_cli',
        status: 'executing',
      })
    ).toBe(TOOL_WATCHDOG_LONG_RUNNING_MS)
  })
  it('bounds retired browser calls that can no longer be executed by the client', () => {
    expect(pendingToolWaitBudgetMs({ name: 'browser_request_takeover', status: 'executing' })).toBe(
      TOOL_WATCHDOG_DEFAULT_MS
    )
  })

  it('waits on a person for as long as the whole turn allows', () => {
    // The 60s default would force-fail a permission prompt while the user was
    // still reading it, resuming Go before they ever answered.
    expect(pendingToolWaitBudgetMs({ name: 'terminal_run', status: 'awaiting_approval' })).toBe(
      TOOL_WATCHDOG_LONG_RUNNING_MS
    )
  })

  it('matches the requested browser_wait_for renderer budget', () => {
    expect(pendingToolWaitBudgetMs({ name: 'browser_wait_for', status: 'executing' })).toBe(85_000)
    expect(
      pendingToolWaitBudgetMs({
        name: 'browser_wait_for',
        status: 'executing',
        params: { timeoutMs: 120_000 },
      })
    ).toBe(195_000)
  })

  it.each([
    'browser_navigate',
    'browser_open_url',
    'browser_go_back',
    'browser_go_forward',
    'browser_reload',
    'browser_open_tab',
    'browser_switch_tab',
  ])('includes authorization, queueing, and navigation in the %s budget', (name) => {
    expect(pendingToolWaitBudgetMs({ name, status: 'executing' })).toBe(130_000)
  })

  it.each(['browser_snapshot', 'browser_find', 'browser_set_checked', 'browser_click'])(
    'allows the renderer queue budget for %s',
    (name) => {
      expect(pendingToolWaitBudgetMs({ name, status: 'executing' })).toBe(90_000)
    }
  )

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
      toolCallId: 'call-1',
      parentToolCallId: 'parent-1',
    })
  })

  it('isolates one tool from a sibling secret activation and merges settled provenance', () => {
    const parentRegistry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secretvalue', encryptedValue: 'encrypted-secret' },
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
    expect(toolRegistry?.recordResolved('TOKEN', 'secretvalue')).toBe(true)
    parentRegistry.mergeToolCallRegistry(toolRegistry!)
    completeSiblingActivation()
    expect(parentRegistry.getActiveMatches()).toEqual([
      { plaintext: 'secretvalue', replacement: '{{TOKEN}}' },
    ])
  })
})

describe('executeToolAndReport provenance isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeTool.mockReset()
    completeAsyncToolCall.mockResolvedValue(null)
    markAsyncToolRunning.mockResolvedValue(null)
    upsertAsyncToolCall.mockResolvedValue(null)
    claimSimToolExecution.mockResolvedValue({ outcome: 'claimed' })
    settleSimToolExecution.mockResolvedValue(undefined)
    waitForToolConfirmation.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('keeps a real embedded workflow execution alive beyond the generic watchdog', async () => {
    vi.useFakeTimers()
    const runWorkflow = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://cli-budget.test/api/v2/workflows/workflow-1/execute')
      expect(request.method).toBe('POST')
      await sleep(70_000)
      request.signal.throwIfAborted()
      return Response.json({
        data: {
          executionId: 'run-1',
          status: 'completed',
          output: { answer: 42 },
        },
      })
    })
    dispatchCli.mockImplementationOnce(runWorkflow)
    queueTableRows(workspace, [
      {
        id: 'workspace-1',
        organizationId: null,
        allowPersonalApiKeys: false,
        billedAccountUserId: 'user-1',
      },
    ])
    executeTool.mockImplementation(async (name, params, context) => {
      expect(name).toBe('sim_cli')
      return executeSimCli(params, context)
    })
    const tool: ToolCallState = {
      ...buildPendingToolCall(),
      name: 'cli_workflows_run',
      execName: 'sim_cli',
      params: {
        request: {
          invocation: {
            kind: 'cli',
            argv: ['workflows', 'run', 'workflow-1', '--manual'],
          },
        },
      },
    }
    const pending = executeToolAndReport(tool.id, buildStreamingContext(tool), {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    })
    await vi.advanceTimersByTimeAsync(80_000)
    const completion = await pending
    expect(tool.error).toBeUndefined()
    expect(completion.status).toBe('success')
    expect(tool.result).toMatchObject({ success: true, output: { exitCode: 0, stderr: '' } })
    const output = tool.result?.output
    expect(output).toHaveProperty('stdout', expect.stringContaining('completed'))
    expect(runWorkflow).toHaveBeenCalledOnce()
    expect(executeTool).toHaveBeenCalledOnce()
    expect(settleSimToolExecution).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'preserves the committed tool result when publication fails (controller abort: %s)',
    async (abortController) => {
      const tool = buildPendingToolCall()
      const controller = new AbortController()
      executeTool.mockResolvedValue({ success: true, output: { created: true } })
      let savedStatus: string | undefined
      completeAsyncToolCall.mockImplementation(async (input) => {
        if (savedStatus) throw new Error('Terminal receipt cannot be replaced')
        savedStatus = input.status
      })
      const publish = vi.fn(async (event) => {
        if (event.payload?.phase === 'result') {
          if (abortController) controller.abort(new Error('Stream controller lost ownership'))
          throw new Error('Stream publication unavailable')
        }
      })
      const result = await executeToolAndReport(
        tool.id,
        buildStreamingContext(tool),
        {
          abortSignal: controller.signal,
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
        },
        { onEvent: publish }
      )
      expect(savedStatus).toBe('completed')
      expect(result.status).toBe('success')
      expect(result.data).toEqual({ created: true })
      expect(completeAsyncToolCall).toHaveBeenCalledOnce()
      expect(executeTool).toHaveBeenCalledOnce()
    }
  )

  it.each([new SimToolExecutionLeaseLostError(), new Error('Receipt storage unavailable')])(
    'returns an interrupted result when a late successful handler receipt is rejected: %s',
    async (error) => {
      const tool = buildPendingToolCall()
      executeTool.mockResolvedValue({ success: true, output: { created: true } })
      completeAsyncToolCall.mockRejectedValue(error)
      const completion = await executeToolAndReport(
        tool.id,
        buildStreamingContext(tool),
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
        },
        { onEvent }
      )
      expect(executeTool).toHaveBeenCalledOnce()
      expect(completion.status).toBe('error')
      expect(completion.message).toContain('outcome is unknown')
      expect(completion.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
      expect(JSON.stringify(completion)).not.toContain('created')
      expect(completeAsyncToolCall).toHaveBeenCalledOnce()
      expect(publishToolConfirmation).not.toHaveBeenCalled()
      expect(
        onEvent.mock.calls.some(
          ([event]) => event.payload?.phase === 'result' && event.payload?.success === true
        )
      ).toBe(false)
    }
  )

  it('preserves a competing terminal result when the handler receipt is rejected', async () => {
    const tool = buildPendingToolCall()
    executeTool.mockResolvedValue({ success: true, output: { created: true } })
    completeAsyncToolCall.mockImplementationOnce(async () => {
      tool.status = 'error'
      tool.endTime = Date.now()
      tool.error = 'Winning watchdog result'
      tool.result = { success: false, output: { error: tool.error, doNotRetry: true } }
      throw new SimToolExecutionLeaseLostError()
    })
    const completion = await executeToolAndReport(tool.id, buildStreamingContext(tool), {
      userId: 'user-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    })
    expect(completion.status).toBe('error')
    expect(completion.message).toBe('Winning watchdog result')
    expect(completion.data).toEqual({ error: 'Winning watchdog result', doNotRetry: true })
    expect(completeAsyncToolCall).toHaveBeenCalledOnce()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('reports an unknown outcome when a thrown handler cannot persist its failure receipt', async () => {
    const tool = buildPendingToolCall()
    executeTool.mockRejectedValueOnce(new Error('Handler failed after a partial mutation'))
    completeAsyncToolCall.mockRejectedValueOnce(new Error('Receipt storage unavailable'))
    const completion = await executeToolAndReport(tool.id, buildStreamingContext(tool), {
      userId: 'user-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    })
    expect(completion.status).toBe('error')
    expect(completion.message).toContain('outcome is unknown')
    expect(completion.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
    expect(completeAsyncToolCall).toHaveBeenCalledOnce()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it.each(['success', 'error', 'cancelled'] as const)(
    'observes another controller until its durable %s result without repeating or settling its execution',
    async (status) => {
      claimSimToolExecution.mockResolvedValueOnce({
        outcome: 'existing',
      })
      let finish: (value: AsyncConfirmationState | null) => void = () => {}
      waitForToolConfirmation.mockImplementationOnce(
        () =>
          new Promise<AsyncConfirmationState | null>((resolve) => {
            finish = resolve
          })
      )
      const tool = buildPendingToolCall()
      let settled = false
      const pending = executeToolAndReport(tool.id, buildStreamingContext(tool), {
        userId: 'user-1',
        workflowId: 'workflow-1',
      }).then((result) => {
        settled = true
        return result
      })
      await vi.waitFor(() => expect(waitForToolConfirmation).toHaveBeenCalledOnce())
      expect(settled).toBe(false)
      expect(tool.result).toBeUndefined()
      finish({ status, data: { recorded: true }, message: 'Recorded outcome' })
      await expect(pending).resolves.toMatchObject({ status })
      expect(tool.result?.output).toEqual({ recorded: true })
      expect(executeTool).not.toHaveBeenCalled()
      expect(completeAsyncToolCall).not.toHaveBeenCalled()
      expect(settleSimToolExecution).not.toHaveBeenCalled()
    }
  )

  it('does not write a failed result or settle the owner when its observation ends unconfirmed', async () => {
    claimSimToolExecution.mockResolvedValueOnce({
      outcome: 'existing',
    })
    waitForToolConfirmation.mockResolvedValueOnce(null)
    const tool = buildPendingToolCall()
    const signal = new AbortController().signal
    await expect(
      executeToolAndReport(tool.id, buildStreamingContext(tool), {
        userId: 'user-1',
        workflowId: 'workflow-1',
        abortSignal: signal,
      })
    ).resolves.toMatchObject({ status: 'running' })
    expect(waitForToolConfirmation).toHaveBeenCalledWith(
      tool.id,
      TOOL_WATCHDOG_DEFAULT_MS,
      signal,
      expect.any(Object)
    )
    expect(tool.result).toBeUndefined()
    expect(executeTool).not.toHaveBeenCalled()
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(settleSimToolExecution).not.toHaveBeenCalled()
  })

  it.each(['row', 'claim'])(
    'refuses dispatch when the execution %s cannot be persisted',
    async (stage) => {
      if (stage === 'row')
        upsertAsyncToolCall.mockRejectedValueOnce(new Error('database unavailable'))
      else claimSimToolExecution.mockRejectedValueOnce(new Error('database unavailable'))
      const tool = buildPendingToolCall()
      await expect(
        executeToolAndReport(tool.id, buildStreamingContext(tool), {
          userId: 'user-1',
          workflowId: 'workflow-1',
        })
      ).resolves.toMatchObject({
        status: 'error',
        message: expect.stringContaining('Tool could not start'),
      })
      expect(executeTool).not.toHaveBeenCalled()
      expect(settleSimToolExecution).not.toHaveBeenCalled()
    }
  )

  it('refuses a late tool after durable Stop closed admission', async () => {
    claimSimToolExecution.mockResolvedValueOnce({ outcome: 'closed' })
    const tool = buildPendingToolCall()
    const result = await executeToolAndReport(tool.id, buildStreamingContext(tool), {
      userId: 'user-1',
      workflowId: 'workflow-1',
    })
    expect(result.status).toBe('cancelled')
    expect(executeTool).not.toHaveBeenCalled()
    expect(settleSimToolExecution).not.toHaveBeenCalled()
  })

  it('finishes the cancelled durable tool row when the stream already marked its UI terminal', async () => {
    const tool = buildPendingToolCall()
    executeTool.mockImplementationOnce(async () => {
      tool.status = 'cancelled'
      tool.error = 'Stopped by user'
      tool.endTime = Date.now()
      return { success: false, error: 'Stopped' }
    })
    const result = await executeToolAndReport(tool.id, buildStreamingContext(tool), {
      userId: 'user-1',
      workflowId: 'workflow-1',
    })
    expect(result.status).toBe('cancelled')
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: tool.id, status: 'cancelled' }),
      expect.any(String)
    )
    expect(settleSimToolExecution).toHaveBeenCalledExactlyOnceWith(tool.id, expect.any(String))
  })

  it('aborts a timed-out handler without cancelling a parallel tool', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const signals = new Map<string, AbortSignal>()
    let finishSibling!: () => void
    executeTool.mockImplementation(async (_name, _params, context: ExecutionContext) => {
      if (!context.abortSignal || !context.toolCallId) throw new Error('Missing tool lifetime')
      signals.set(context.toolCallId, context.abortSignal)
      return new Promise((resolve) => {
        const finish = () => resolve({ success: false, error: 'Stopped' })
        context.abortSignal?.addEventListener('abort', finish, { once: true })
        if (context.toolCallId === 'sibling') finishSibling = finish
      })
    })
    const tool = buildPendingToolCall()
    const sibling = { ...buildPendingToolCall(), id: 'sibling', name: 'run_code' }
    const context: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      abortSignal: parent.signal,
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    }
    const first = executeToolAndReport(tool.id, buildStreamingContext(tool), context)
    const second = executeToolAndReport(sibling.id, buildStreamingContext(sibling), context)
    try {
      await vi.advanceTimersByTimeAsync(TOOL_WATCHDOG_DEFAULT_MS)
      expect(signals.get(tool.id)?.aborted).toBe(true)
      expect(signals.get(sibling.id)?.aborted).toBe(false)
      expect(parent.signal.aborted).toBe(false)
      const completion = await first
      expect(completion.status).toBe('error')
      expect(tool.error).toContain('timed out')
    } finally {
      parent.abort()
      finishSibling?.()
      await Promise.allSettled([first, second])
    }
  })

  it('does not execute or mutate a tool row owned by another run', async () => {
    const toolCall = buildPendingToolCall()
    const conflict = new AsyncToolCallOwnershipError()
    upsertAsyncToolCall.mockRejectedValueOnce(conflict)

    await expect(
      executeToolAndReport(toolCall.id, buildStreamingContext(toolCall), { userId: 'user-1' })
    ).rejects.toBe(conflict)

    expect(markAsyncToolRunning).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('merges a complete child only after its projected result is safe', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value', {
          propagated: true,
        })
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: { value: '{{TOKEN}}' },
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
    ])
  })

  it('structurally omits an incomplete result without poisoning the parent turn', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: { success: true },
    })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('structurally fails an incomplete thrown error without poisoning the parent turn', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        throw new Error('secret-value')
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      { userId: 'user-1', workflowId: 'workflow-1', resolvedSecretTraceRegistry: registry },
      { onEvent }
    )

    expect(completion.status).toBe(MothershipStreamV1ToolOutcome.error)
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('discards an incomplete child when execution is aborted before result delivery', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const abortController = new AbortController()
    executeTool.mockImplementationOnce(
      async (
        _toolName: string,
        _params: Record<string, unknown>,
        toolContext: ExecutionContext
      ) => {
        toolContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
        abortController.abort()
        return { success: true, output: { value: 'secret-value' } }
      }
    )
    const toolCall = buildPendingToolCall()

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        abortSignal: abortController.signal,
        resolvedSecretTraceRegistry: registry,
      },
      { onEvent }
    )

    expect(completion.status).toBe(MothershipStreamV1ToolOutcome.cancelled)
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify([completion, onEvent.mock.calls])).not.toContain('secret-value')
  })

  it('reveals a generated API key only in the live client event', async () => {
    const generatedKey = 'sk-sim-one-time-secret'
    const statusMessage = 'API key "streaming-test" created.'
    executeTool.mockResolvedValueOnce({
      success: true,
      output: {
        id: 'key-1',
        name: 'streaming-test',
        key: generatedKey,
        workspaceId: 'workspace-1',
        message: statusMessage,
      },
    })
    const toolCall: ToolCallState = {
      id: 'generate-key-call',
      name: GenerateApiKey.id,
      status: 'pending',
      params: { name: 'streaming-test' },
    }

    const completion = await executeToolAndReport(
      toolCall.id,
      buildStreamingContext(toolCall),
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      },
      { onEvent }
    )

    expect(completion).toEqual({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data: statusMessage,
    })
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ result: statusMessage }),
      expect.any(String)
    )
    expect(JSON.stringify([completion, completeAsyncToolCall.mock.calls])).not.toContain(
      generatedKey
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolName: GenerateApiKey.id,
          phase: MothershipStreamV1ToolPhase.result,
          success: true,
          output: expect.objectContaining({ key: generatedKey }),
        }),
      })
    )
  })
})

describe('executeToolAndReport metrics', () => {
  const executionContext: ExecutionContext = {
    userId: 'user-1',
    workflowId: 'workflow-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the stored agent on normal completion', async () => {
    const toolCall: ToolCallState = {
      id: 'call-1',
      name: 'read',
      status: MothershipStreamV1ToolOutcome.success,
      result: { success: true, output: 'done' },
      agentId: 'workflow',
      endTime: Date.now(),
    }
    const context = createStreamingContext({
      toolCalls: new Map([[toolCall.id, toolCall]]),
    })

    await executeToolAndReport(toolCall.id, context, executionContext)

    expect(recordSimToolMetric).toHaveBeenCalledWith(
      'read',
      'workflow',
      MothershipStreamV1ToolOutcome.success,
      expect.any(Number)
    )
    expect(withCopilotToolSpan).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'workflow' }),
      expect.any(Function)
    )
  })

  it.each([
    { agentId: 'workflow', expectedAgentId: 'workflow' },
    { agentId: undefined, expectedAgentId: 'main' },
  ])(
    'forwards $expectedAgentId when an unexpected error occurs',
    async ({ agentId, expectedAgentId }) => {
      const toolCall: ToolCallState = {
        id: 'call-2',
        name: 'read',
        status: MothershipStreamV1ToolOutcome.error,
        agentId,
        endTime: Date.now(),
      }
      const context = createStreamingContext({
        toolCalls: new Map([[toolCall.id, toolCall]]),
      })

      await expect(executeToolAndReport(toolCall.id, context, executionContext)).rejects.toThrow(
        'missing a canonical error'
      )
      expect(recordSimToolMetric).toHaveBeenCalledWith(
        'read',
        expectedAgentId,
        MothershipStreamV1ToolOutcome.error,
        expect.any(Number)
      )
      expect(withCopilotToolSpan).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: expectedAgentId }),
        expect.any(Function)
      )
    }
  )
})

describe('watchdog completion provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptSecret.mockImplementation(async (plaintext: string) => ({ encrypted: plaintext }))
    decryptSecret.mockImplementation(async (encrypted: string) => ({ decrypted: encrypted }))
    completeAsyncToolCall.mockImplementation(async (input) => ({ ...input }))
    replaceTerminalAsyncToolCallResult.mockImplementation(async (input) => ({ ...input }))
  })

  function createHungClient() {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'private-command-token', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'private-command-token')
    const toolCall: ToolCallState = {
      id: 'terminal-call',
      name: 'terminal_run',
      status: 'executing',
      params: { command: 'private-command-token' },
    }
    const context = buildStreamingContext(toolCall)
    const execContext: ExecutionContext = {
      userId: 'user-1',
      resolvedSecretTraceRegistry: registry,
    }
    return { registry, toolCall, context, execContext }
  }

  it('restores a trusted timeout through the real sealed client completion reader', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    const finishSiblingActivation = registry.beginPendingActivation()

    await failPendingToolCall(toolCall.id, context, execContext)
    const persisted = completeAsyncToolCall.mock.calls[0][0]
    expect(persisted.result).toEqual({
      __sealedClientToolCompletionV1: expect.any(String),
      __sealedClientToolContextV1: expect.any(String),
    })
    waitForToolConfirmation.mockResolvedValue({
      status: 'error',
      message: persisted.error,
      data: persisted.result,
    })

    const completion = await waitForClientToolCompletion({
      toolCallId: toolCall.id,
      runId: context.runId,
      userId: execContext.userId,
      timeoutMs: 1,
      registry,
    })
    finishSiblingActivation()

    expect(completion).toEqual({
      status: 'error',
      message: expect.stringContaining('outcome is unknown'),
      data: {
        error: expect.stringContaining('hung'),
        outcomeUnknown: true,
        doNotRetry: true,
      },
    })
    expect(registry.isComplete()).toBe(true)
    expect(mockError).not.toHaveBeenCalledWith(
      'Client tool provenance could not be restored',
      expect.anything()
    )
    expect(
      JSON.stringify([persisted, publishToolConfirmation.mock.calls, completion])
    ).not.toContain('private-command-token')
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ data: persisted.result })
    )
  })

  it('preserves an actual completion that settles while encryption is pending', async () => {
    const { toolCall, context, execContext } = createHungClient()
    let finishEncryption: (value: { encrypted: string }) => void = () => {}
    encryptSecret.mockImplementationOnce(
      () =>
        new Promise<{ encrypted: string }>((resolve) => {
          finishEncryption = resolve
        })
    )
    const settlement = failPendingToolCall(toolCall.id, context, execContext)
    toolCall.status = 'success'
    toolCall.endTime = Date.now()
    toolCall.result = { success: true, output: 'actual completion' }
    finishEncryption({ encrypted: 'unused' })
    await settlement

    expect(toolCall.result).toEqual({ success: true, output: 'actual completion' })
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('does not publish or overwrite an actual completion that wins the durable race', async () => {
    const { toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockImplementationOnce(async () => {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = { success: true, output: 'actual completion' }
      return null
    })

    await failPendingToolCall(toolCall.id, context, execContext)

    expect(toolCall.status).toBe('success')
    expect(toolCall.result).toEqual({ success: true, output: 'actual completion' })
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('reports unavailable output locally when the durable winner has no settled live result', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockResolvedValueOnce(null)

    await failPendingToolCall(toolCall.id, context, execContext)

    expect(toolCall.status).toBe('error')
    expect(toolCall.error).toContain('result could not be restored')
    expect(toolCall.result).toEqual({
      success: false,
      output: { error: toolCall.error, outcomeUnknown: true, doNotRetry: true },
    })
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(registry.isComplete()).toBe(true)
  })

  it('allows the valid winning client completion to replace a local unavailable-result fallback', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    completeAsyncToolCall.mockResolvedValueOnce(null)
    await failPendingToolCall(toolCall.id, context, execContext)
    expect(toolCall.status).toBe('error')
    const binding = { toolCallId: toolCall.id, runId: 'run-1', userId: execContext.userId }
    waitForToolConfirmation.mockResolvedValueOnce({
      status: 'success',
      data: {
        ...(await sealClientToolContext({ ...binding, registry, toolInput: undefined })),
        ...(await sealClientToolCompletion({
          ...binding,
          message: 'Tool completed',
          data: { exitCode: 0, output: 'successful output' },
        })),
      },
    })
    const completion = await waitForClientToolCompletion({
      ...binding,
      registry,
      timeoutMs: 1,
    })
    handleClientCompletion(context, toolCall, toolCall.id, completion)

    expect(toolCall.status).toBe('success')
    expect(toolCall.result).toEqual({
      success: true,
      output: { exitCode: 0, output: 'successful output' },
    })
    expect(registry.isComplete()).toBe(true)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(mockError).not.toHaveBeenCalledWith(
      'Client tool provenance could not be restored',
      expect.anything()
    )
  })

  it('never falls back to an unsealed durable result when sealing fails', async () => {
    const { registry, toolCall, context, execContext } = createHungClient()
    encryptSecret.mockRejectedValueOnce(new Error('encryption unavailable'))

    await failPendingToolCall(toolCall.id, context, execContext)

    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
    expect(toolCall.status).toBe('error')
    expect(toolCall.error).toContain('outcome is unknown')
    expect(registry.isComplete()).toBe(true)
  })

  it('retains structural failure compatibility when no provenance registry exists', async () => {
    const { toolCall, context } = createHungClient()

    await failPendingToolCall(toolCall.id, context, { userId: 'user-1' })

    expect(toolCall.status).toBe('error')
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { error: expect.any(String), outcomeUnknown: true, doNotRetry: true },
      })
    )
    expect(encryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    ['file output', maybeWriteOutputToFile],
    ['table output', maybeWriteOutputToTable],
    ['CSV output', maybeWriteReadCsvToTable],
  ] as const)(
    'ignores a late %s completion after watchdog settlement',
    async (_name, postprocess) => {
      const toolCall = buildPendingToolCall()
      const context = buildStreamingContext(toolCall)
      const execContext: ExecutionContext = {
        userId: 'user-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      }
      const result = { success: true, output: 'late output' }
      executeTool.mockResolvedValueOnce(result)
      let finishPostprocessing: (value: typeof result) => void = () => {}
      let startedPostprocessing: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        startedPostprocessing = resolve
      })
      vi.mocked(postprocess).mockImplementationOnce(async () => {
        startedPostprocessing()
        return await new Promise<typeof result>((resolve) => {
          finishPostprocessing = resolve
        })
      })
      const execution = executeToolAndReport(toolCall.id, context, execContext)
      await started
      await failPendingToolCall(toolCall.id, context, execContext)
      finishPostprocessing(result)
      const completion = await execution

      expect(completion.status).toBe('error')
      expect(completion.message).toContain('hung')
      expect(toolCall.status).toBe('error')
      expect(completeAsyncToolCall).toHaveBeenCalledTimes(1)
      expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(completion)).not.toContain('late output')
    }
  )

  it.each([false, true])(
    'does not publish a stale completion when the watchdog wins during persistence (aborted: %s)',
    async (aborted) => {
      const toolCall = buildPendingToolCall()
      const context = buildStreamingContext(toolCall)
      const execContext: ExecutionContext = {
        userId: 'user-1',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      }
      const result = { success: true, output: 'late output' }
      executeTool.mockResolvedValueOnce(result)
      let finishPostprocessing: (value: typeof result) => void = () => {}
      let startedPostprocessing: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        startedPostprocessing = resolve
      })
      vi.mocked(maybeWriteOutputToFile).mockImplementationOnce(async () => {
        startedPostprocessing()
        return await new Promise<typeof result>((resolve) => {
          finishPostprocessing = resolve
        })
      })
      let finishWatchdogPersistence: (value: object) => void = () => {}
      let startedWatchdogPersistence: () => void = () => {}
      const watchdogWriting = new Promise<void>((resolve) => {
        startedWatchdogPersistence = resolve
      })
      completeAsyncToolCall.mockImplementationOnce(async () => {
        startedWatchdogPersistence()
        return await new Promise<object>((resolve) => {
          finishWatchdogPersistence = resolve
        })
      })
      let finishToolPersistence: (value: null) => void = () => {}
      let startedToolPersistence: () => void = () => {}
      const toolWriting = new Promise<void>((resolve) => {
        startedToolPersistence = resolve
      })
      completeAsyncToolCall.mockImplementationOnce(async () => {
        startedToolPersistence()
        return await new Promise<null>((resolve) => {
          finishToolPersistence = resolve
        })
      })

      const controller = new AbortController()
      const execution = executeToolAndReport(toolCall.id, context, execContext, {
        onEvent,
        abortSignal: controller.signal,
      })
      await started
      const watchdog = failPendingToolCall(toolCall.id, context, execContext)
      await watchdogWriting
      if (aborted) controller.abort()
      finishPostprocessing(result)
      await toolWriting
      finishWatchdogPersistence({ status: 'failed' })
      await watchdog
      finishToolPersistence(null)
      const completion = await execution

      expect(completion.status).toBe('error')
      expect(completion.message).toContain('hung')
      expect(toolCall.status).toBe('error')
      expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
      expect(onEvent).not.toHaveBeenCalled()
      expect(JSON.stringify(completion)).not.toContain('late output')
    }
  )

  it('ignores a late postprocessing rejection after watchdog settlement', async () => {
    const toolCall = buildPendingToolCall()
    const context = buildStreamingContext(toolCall)
    const execContext: ExecutionContext = {
      userId: 'user-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    }
    executeTool.mockResolvedValueOnce({ success: true, output: 'late output' })
    let rejectPostprocessing: (error: Error) => void = () => {}
    let startedPostprocessing: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      startedPostprocessing = resolve
    })
    vi.mocked(maybeWriteOutputToFile).mockImplementationOnce(async () => {
      startedPostprocessing()
      return await new Promise<never>((_resolve, reject) => {
        rejectPostprocessing = reject
      })
    })
    const execution = executeToolAndReport(toolCall.id, context, execContext)
    await started
    await failPendingToolCall(toolCall.id, context, execContext)
    rejectPostprocessing(new Error('late rejected secret output'))
    const completion = await execution

    expect(completion.status).toBe('error')
    expect(completion.message).toContain('hung')
    expect(completeAsyncToolCall).toHaveBeenCalledTimes(1)
    expect(publishToolConfirmation).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(completion)).not.toContain('late rejected secret output')
  })
})
