/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockArchiveSuite,
  mockAuthorize,
  mockCreateSuite,
  mockGetSuite,
  mockListSuites,
  mockLoadRun,
  mockRunSuite,
  mockRunTest,
  mockStopRun,
  mockUpdateSuite,
} = vi.hoisted(() => ({
  mockArchiveSuite: vi.fn(),
  mockAuthorize: vi.fn(),
  mockCreateSuite: vi.fn(),
  mockGetSuite: vi.fn(),
  mockListSuites: vi.fn(),
  mockLoadRun: vi.fn(),
  mockRunSuite: vi.fn(),
  mockRunTest: vi.fn(),
  mockStopRun: vi.fn(),
  mockUpdateSuite: vi.fn(),
}))

vi.mock('@/lib/workflows/evals/access', () => ({ authorizeWorkflowEvalAccess: mockAuthorize }))
vi.mock('@/lib/workflows/evals/run-detail-loader', () => ({
  loadWorkflowEvalRunDetail: mockLoadRun,
}))
vi.mock('@/lib/workflows/evals/run-service', () => ({
  startWorkflowEvalSuiteRun: mockRunSuite,
  startWorkflowEvalTestRun: mockRunTest,
  stopWorkflowEvalRun: mockStopRun,
}))
vi.mock('@/lib/workflows/evals/suite-service', () => ({
  archiveWorkflowEvalSuite: mockArchiveSuite,
  createWorkflowEvalSuite: mockCreateSuite,
  getWorkflowEvalSuite: mockGetSuite,
  listWorkflowEvalSuites: mockListSuites,
  updateWorkflowEvalSuite: mockUpdateSuite,
}))

import {
  archiveWorkflowEvalSuiteServerTool,
  createWorkflowEvalSuiteServerTool,
  getWorkflowEvalRunServerTool,
  getWorkflowEvalSuiteServerTool,
  listWorkflowEvalSuitesServerTool,
  runWorkflowEvalSuiteServerTool,
  runWorkflowEvalTestServerTool,
  stopWorkflowEvalRunServerTool,
  updateWorkflowEvalSuiteServerTool,
} from '@/lib/copilot/tools/server/evals/workflow-evals'

const CONTEXT = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  userPermission: 'write',
}

describe('workflow Eval server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorize.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
  })

  it('discards injected transport context across every Eval operation and stays strict', () => {
    const cases = [
      {
        tool: listWorkflowEvalSuitesServerTool,
        args: { workflowId: 'workflow-1' },
      },
      {
        tool: getWorkflowEvalSuiteServerTool,
        args: { workflowId: 'workflow-1', suiteId: 'suite-1' },
      },
      {
        tool: createWorkflowEvalSuiteServerTool,
        args: {
          workflowId: 'workflow-1',
          name: 'Timing regression',
          tests: [
            {
              clientRef: 'minimum-duration',
              name: 'Waits at least one second',
              input: {},
              errorBlockIds: ['wait-block'],
              evaluator: {
                type: 'code',
                code: 'return blockOutputs[0].occurrences.length > 0',
                outputSelectors: [{ blockId: 'wait-block', path: 'result' }],
              },
            },
          ],
        },
      },
      {
        tool: updateWorkflowEvalSuiteServerTool,
        args: {
          workflowId: 'workflow-1',
          suiteId: 'suite-1',
          expectedDefinitionRevision: 1,
          renameTo: 'Updated timing regression',
        },
      },
      {
        tool: archiveWorkflowEvalSuiteServerTool,
        args: {
          workflowId: 'workflow-1',
          suiteId: 'suite-1',
          expectedDefinitionRevision: 1,
        },
      },
      {
        tool: runWorkflowEvalSuiteServerTool,
        args: {
          workflowId: 'workflow-1',
          suiteId: 'suite-1',
          expectedDefinitionRevision: 1,
        },
      },
      {
        tool: runWorkflowEvalTestServerTool,
        args: {
          workflowId: 'workflow-1',
          suiteId: 'suite-1',
          testId: 'test-1',
          expectedDefinitionRevision: 1,
        },
      },
      {
        tool: getWorkflowEvalRunServerTool,
        args: { workflowId: 'workflow-1', suiteId: 'suite-1', runId: 'run-1' },
      },
      {
        tool: stopWorkflowEvalRunServerTool,
        args: { workflowId: 'workflow-1', suiteId: 'suite-1', runId: 'run-1' },
      },
    ]

    for (const { tool, args } of cases) {
      const parsed = tool.inputSchema?.parse({
        ...args,
        chatId: 'chat-1',
        workspaceId: 'workspace-1',
      })

      expect(parsed).not.toHaveProperty('chatId')
      expect(parsed).not.toHaveProperty('workspaceId')
      expect(() => tool.inputSchema?.parse({ ...args, unexpected: true })).toThrow()
    }
  })

  it('lists bounded suite summaries through the shared access boundary', async () => {
    mockListSuites.mockResolvedValue({ items: [], nextCursor: null })

    const args = listWorkflowEvalSuitesServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
    })
    const result = await listWorkflowEvalSuitesServerTool.execute(args, CONTEXT)

    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'read',
      expectedWorkspaceId: 'workspace-1',
    })
    expect(mockListSuites).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      includeArchived: false,
      limit: 50,
      cursor: undefined,
    })
    expect(result).toEqual({ items: [], nextCursor: null })
  })

  it('accepts complete LLM-as-judge definitions and delegates canonical ID generation', async () => {
    mockCreateSuite.mockResolvedValue({ id: 'suite-1' })
    const args = createWorkflowEvalSuiteServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      name: 'Support regression',
      tests: [
        {
          clientRef: 'refund',
          name: 'Answers refund questions',
          input: { message: 'Can I get a refund?' },
          mocks: [{ blockId: 'policy-lookup', output: ['30-day refund window'] }],
          errorBlockIds: ['answer'],
          evaluator: {
            type: 'agent',
            model: 'gpt-4.1-mini',
            criteria: [
              {
                clientRef: 'correctness',
                name: 'Correctness',
                description: 'The answer accurately explains the refund policy.',
              },
            ],
            outputSelectors: [{ blockId: 'answer', path: 'content' }],
          },
        },
      ],
    })

    await createWorkflowEvalSuiteServerTool.execute(args, CONTEXT)

    expect(mockCreateSuite).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        input: expect.objectContaining({
          tests: [
            expect.objectContaining({
              mocks: [{ blockId: 'policy-lookup', output: ['30-day refund window'] }],
            }),
          ],
        }),
      })
    )
  })

  it('passes the user-stop check into the atomic update boundary', async () => {
    const userStop = new AbortController()
    const context = { ...CONTEXT, userStopSignal: userStop.signal }
    const args = updateWorkflowEvalSuiteServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      expectedDefinitionRevision: 2,
      renameTo: 'Renamed regression',
    })
    mockUpdateSuite.mockImplementation(async ({ assertNotAborted }) => {
      userStop.abort('user_stop')
      assertNotAborted()
    })

    await expect(updateWorkflowEvalSuiteServerTool.execute(args, context)).rejects.toThrow(
      'User stopped before the Eval suite update committed'
    )
  })

  it('includes the workflow id in archive results for client cache reconciliation', async () => {
    mockArchiveSuite.mockResolvedValue({
      suiteId: 'suite-1',
      definitionRevision: 3,
      archivedAt: new Date('2026-07-18T00:00:00.000Z'),
    })
    const args = archiveWorkflowEvalSuiteServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      expectedDefinitionRevision: 2,
    })

    const result = await archiveWorkflowEvalSuiteServerTool.execute(args, CONTEXT)

    expect(result).toEqual(
      expect.objectContaining({
        suiteId: 'suite-1',
        workflowId: 'workflow-1',
      })
    )
  })

  it('queues exactly one canonical saved test and returns without polling', async () => {
    mockRunTest.mockResolvedValue({ runId: 'run-1', status: 'queued', scope: 'test' })
    const args = runWorkflowEvalTestServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      testId: 'test-1',
      expectedDefinitionRevision: 3,
    })

    const result = await runWorkflowEvalTestServerTool.execute(args, CONTEXT)

    expect(mockRunTest).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      testId: 'test-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      expectedDefinitionRevision: 3,
    })
    expect(mockLoadRun).not.toHaveBeenCalled()
    expect(result).toEqual({ runId: 'run-1', status: 'queued', scope: 'test' })
  })

  it('reads durable failure details without converting negative Eval outcomes to tool errors', async () => {
    mockLoadRun.mockResolvedValue({
      status: 'completed',
      failedCount: 1,
      tests: [{ testId: 'test-1', outcome: 'fail', score: 0 }],
    })
    const args = getWorkflowEvalRunServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      view: 'failures',
    })

    const result = await getWorkflowEvalRunServerTool.execute(args, CONTEXT)

    expect(result).toEqual(
      expect.objectContaining({
        status: 'completed',
        failedCount: 1,
      })
    )
  })

  it('stops one canonical Eval run through the shared write boundary', async () => {
    mockStopRun.mockResolvedValue({ runId: 'run-1', status: 'cancelled', revision: 4 })
    const args = stopWorkflowEvalRunServerTool.inputSchema?.parse({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
    })

    const result = await stopWorkflowEvalRunServerTool.execute(args, CONTEXT)

    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'write',
      expectedWorkspaceId: 'workspace-1',
    })
    expect(mockStopRun).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    expect(result).toEqual({ runId: 'run-1', status: 'cancelled', revision: 4 })
  })
})
