import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { authInternalMock } from '@sim/testing/mocks/auth-internal.mock'
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import { customBlockOperationsMock } from '@sim/testing/mocks/custom-block-operations.mock'
import { encryptionMock } from '@sim/testing/mocks/encryption.mock'
import { loggingSessionMock } from '@sim/testing/mocks/logging-session.mock'
import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import { permissionsMock } from '@sim/testing/mocks/permissions.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { usersQueriesMock } from '@sim/testing/mocks/users-queries.mock'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import { writeEvalReport } from '@/evals/agent-tool-use/report'
import type { AgentToolUseResult, EvalCheck } from '@/evals/agent-tool-use/types'
import { DAGExecutor } from '@/executor/execution/executor'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * Orchestration eval: a parent workflow invokes a child through the Workflow
 * block, driven by the real `DAGExecutor`.
 *
 * The child `Executor` and the definition loader are mocked so the parent's
 * spawn → wait → aggregate → recover path runs end to end without a database.
 * The parent executor, workflow handler, serializer, and output mapping are real.
 */
const { mockChildExecute, mockReadDefinition } = vi.hoisted(() => ({
  mockChildExecute: vi.fn(),
  mockReadDefinition: vi.fn(),
}))

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [], totalDuration: 0 })),
  isHiddenOutputKey: vi.fn(() => false),
  filterHiddenOutputKeys: vi.fn((value: unknown) => value),
  hasUnhandledError: vi.fn(() => false),
  traceSpansIndicateFailure: vi.fn(() => false),
  withSpanDurationMs: vi.fn((span: unknown) => span),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/workflows/custom-blocks/child-execution', () => ({
  admitCustomBlockChildExecution: vi.fn(async () => undefined),
  trackChildRun: vi.fn(),
}))
vi.mock('@/executor', () => ({
  Executor: class {
    constructor(_options: unknown) {}
    execute = mockChildExecute
  },
}))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/users/queries', () => usersQueriesMock)
vi.mock('@/lib/internal/workflows/read-definition', () => ({
  readWorkflowDefinitionAsExecutor: mockReadDefinition,
}))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {
    resolveSnapshot: vi.fn(async () => ({
      id: 'snapshot-1',
      workflowId: 'child-workflow',
      stateHash: 'state-hash',
    })),
    rememberReferencedSnapshot: vi.fn(),
    computeStateHash: vi.fn(() => 'state-hash'),
    createSnapshotWithDeduplication: vi.fn(),
  },
}))
vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/execution/cancellation', () => ({
  subscribeToExecutionCancellation: vi.fn(async () => () => {}),
  isExecutionCancelled: vi.fn(async () => false),
}))

function buildParentWorkflow(): SerializedWorkflow {
  const start: SerializedBlock = createSerializedBlock({
    id: 'start',
    type: 'start_trigger',
    name: 'Start',
  })
  if (start.metadata) start.metadata.category = 'triggers'
  const callChild: SerializedBlock = createSerializedBlock({
    id: 'call-child',
    type: 'workflow',
    name: 'Call Child',
  })
  callChild.config.tool = 'workflow'
  callChild.config.params = { workflowId: 'child-workflow' }
  return createSerializedWorkflow([start, callChild], [{ source: 'start', target: 'call-child' }])
}

function runParent(): Promise<{ success?: boolean; output?: Record<string, unknown> }> {
  const principal = createSessionPrincipal()
  const executor = new DAGExecutor({
    workflow: buildParentWorkflow(),
    contextExtensions: {
      workspaceId: 'eval-workspace',
      executionId: 'eval-execution',
      userId: 'eval-user',
      principal,
      executorDelegationOrigin: {
        subjectUserId: 'eval-user',
        workflowId: 'eval-parent',
        executionId: 'eval-execution',
        principal,
        currentWorkflow: { workflowId: 'eval-parent', mode: 'draft' },
      },
    },
  })
  return executor.execute('eval-parent') as Promise<{
    success?: boolean
    output?: Record<string, unknown>
  }>
}

const mockGetBlock = getBlock as Mock

beforeEach(() => {
  /** The registry mock has no `tools`; the serializer/child validation reads `tools.access`. */
  mockGetBlock.mockImplementation((type: string) => ({
    name: type,
    description: 'Mock block',
    icon: () => null,
    subBlocks: [],
    outputs: {},
    tools: { access: [] },
  }))

  mockReadDefinition.mockResolvedValue({
    workflow: {
      id: 'child-workflow',
      name: 'Child Workflow',
      workspaceId: 'eval-workspace',
      variables: {},
    },
    workspaceId: 'eval-workspace',
    state: {
      blocks: [
        {
          id: 'starter',
          metadata: { id: 'starter', name: 'Starter' },
          position: { x: 0, y: 0 },
          config: { tool: 'starter', params: {} },
          inputs: {},
          outputs: {},
          subBlocks: {},
          enabled: true,
        },
      ],
      edges: [],
      loops: {},
      parallels: {},
    },
  })
})

const results: AgentToolUseResult[] = []

function record(id: string, name: string, checks: EvalCheck[], output: unknown): void {
  results.push({
    id,
    name,
    category: 'planning',
    passed: checks.every((check) => check.passed),
    checks,
    finalContent: JSON.stringify(output ?? null),
    toolInvocations: [],
    metrics: {
      iterations: 1,
      toolCalls: 0,
      successfulToolCalls: 0,
      erroredToolCalls: 0,
      latencyMs: 0,
      modelTimeMs: 0,
      toolsTimeMs: 0,
      firstResponseTimeMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  })
}

afterAll(() => {
  const reportPath = process.env.EVAL_ORCHESTRATION_REPORT_PATH
  if (reportPath) writeEvalReport(results, reportPath)
})

describe('agent orchestration eval suite', () => {
  it('propagates a child workflow result to the parent', async () => {
    mockChildExecute.mockResolvedValue({
      success: true,
      output: { answer: 'child says hi' },
    })

    const result = await runParent()
    const checks: EvalCheck[] = [
      {
        name: 'parent-succeeds',
        passed: result.success === true,
        detail: `success=${result.success}`,
      },
      {
        name: 'child-id-on-parent',
        passed: result.output?.childWorkflowId === 'child-workflow',
        detail: `childWorkflowId=${String(result.output?.childWorkflowId)}`,
      },
      {
        name: 'child-output-on-parent',
        passed:
          (result.output?.result as { answer?: string } | undefined)?.answer === 'child says hi',
        detail: `result=${JSON.stringify(result.output?.result)}`,
      },
    ]
    record(
      'orchestration-propagates-child',
      'child output reaches the parent',
      checks,
      result.output
    )

    expect(checks.filter((check) => !check.passed)).toEqual([])
  })

  it('fails the parent when the child workflow fails', async () => {
    mockChildExecute.mockResolvedValue({
      success: false,
      error: 'child exploded',
      output: {},
    })

    const result = await runParent().catch(() => undefined)
    const checks: EvalCheck[] = [
      {
        name: 'parent-fails',
        passed: (result?.success ?? false) === false,
        detail: `success=${String(result?.success)}`,
      },
    ]
    record('orchestration-child-failure', 'child failure fails the parent', checks, result?.output)

    expect(checks.filter((check) => !check.passed)).toEqual([])
  })
})
