import { describe, expect, it } from 'vitest'
import {
  MAX_WORKFLOW_EVAL_CRITERIA,
  MAX_WORKFLOW_EVAL_JUDGE_REASON_CHARS,
  MAX_WORKFLOW_EVAL_SUITE_BYTES,
  workflowEvalCriterionJudgeOutputSchema,
  workflowEvalDefinitionSnapshotSchema,
  workflowEvalEvaluatorSchema,
  workflowEvalLatestRunSchema,
  workflowEvalRunTestDefinitionResponseSchema,
  workflowEvalStreamEventSchema,
  workflowEvalTestRunSchema,
  workflowEvalTestsSchema,
} from '@/lib/api/contracts/workflow-evals'

const RUN_TIMESTAMPS = {
  createdAt: new Date('2026-07-16T12:00:00.000Z'),
  updatedAt: new Date('2026-07-16T12:00:01.000Z'),
  startedAt: new Date('2026-07-16T12:00:01.000Z'),
} as const

const TYPED_ERROR = {
  kind: 'evaluator' as const,
  code: 'invalid_output',
  message: 'The evaluator returned an invalid value',
}

function codeTestRun() {
  return {
    id: 'test-run-1',
    testId: 'test-1',
    name: 'Returns a useful answer',
    ordinal: 0,
    evaluatorType: 'code' as const,
    phase: 'completed' as const,
    outcome: 'pass' as const,
    score: 10,
    subjectExecutionId: 'execution-1',
    judgeExecutionId: null,
    error: null,
    criteria: [] as [],
  }
}

function runningStreamRun() {
  return {
    id: 'run-1',
    scope: 'suite' as const,
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status: 'running' as const,
    revision: 2,
    completedCount: 1,
    passedCount: 1,
    warningCount: 0,
    failedCount: 0,
    errorCount: 0,
    totalCount: 2,
    ...RUN_TIMESTAMPS,
    completedAt: null,
    error: null,
  }
}

describe('workflow eval definitions', () => {
  it('accepts code evaluators with optional selected block outputs and bounded agent definitions', () => {
    expect(
      workflowEvalEvaluatorSchema.parse({ type: 'code', code: 'return output.ok === true' })
    ).toEqual({ type: 'code', code: 'return output.ok === true' })

    expect(
      workflowEvalEvaluatorSchema.parse({
        type: 'code',
        code: "return blockOutputs[0]?.occurrences[0]?.value === 'billing'",
        outputSelectors: [{ blockId: 'router-1', path: 'route' }],
      })
    ).toMatchObject({
      type: 'code',
      outputSelectors: [{ blockId: 'router-1', path: 'route' }],
    })

    expect(
      workflowEvalEvaluatorSchema.parse({
        type: 'agent',
        model: 'judge-model',
        criteria: [
          { id: 'useful', name: 'Useful', description: 'The answer resolves the request.' },
          { id: 'safe', name: 'Safe', description: 'The answer does not create unsafe actions.' },
        ],
        outputSelectors: [
          { blockId: 'agent-1', path: '' },
          { blockId: 'formatter-1', path: 'result.content' },
        ],
      })
    ).toMatchObject({ type: 'agent', criteria: [{ id: 'useful' }, { id: 'safe' }] })
  })

  it('defaults test error blocks and rejects duplicate block ids', () => {
    const [test] = workflowEvalTestsSchema.parse([
      {
        id: 'test-1',
        name: 'Routes to billing',
        input: { message: 'I was charged twice' },
        evaluator: { type: 'code', code: 'return true' },
      },
    ])
    expect(test?.errorBlockIds).toEqual([])

    expect(
      workflowEvalTestsSchema.safeParse([
        {
          id: 'test-1',
          name: 'Routes to billing',
          input: { message: 'I was charged twice' },
          errorBlockIds: ['router-1', 'router-1'],
          evaluator: { type: 'code', code: 'return true' },
        },
      ]).success
    ).toBe(false)
  })

  it('accepts JSON block mocks and rejects duplicate mock block ids', () => {
    const [test] = workflowEvalTestsSchema.parse([
      {
        id: 'test-1',
        name: 'Uses a mocked ticket lookup',
        input: { message: 'Where is ticket SIM-42?' },
        mocks: [
          {
            blockId: 'ticket-lookup',
            output: { status: 'open', assignee: { name: 'Ada' } },
          },
        ],
        evaluator: { type: 'code', code: "return output.status === 'open'" },
      },
    ])
    expect(test?.mocks).toEqual([
      {
        blockId: 'ticket-lookup',
        output: { status: 'open', assignee: { name: 'Ada' } },
      },
    ])

    expect(
      workflowEvalTestsSchema.safeParse([
        {
          id: 'test-1',
          name: 'Duplicate mocks',
          input: {},
          mocks: [
            { blockId: 'ticket-lookup', output: { status: 'open' } },
            { blockId: 'ticket-lookup', output: { status: 'closed' } },
          ],
          evaluator: { type: 'code', code: 'return true' },
        },
      ]).success
    ).toBe(false)
  })

  it('validates an immutable run test definition response', () => {
    expect(
      workflowEvalRunTestDefinitionResponseSchema.parse({
        runId: 'run-1',
        suiteId: 'suite-1',
        suiteDefinitionRevision: 4,
        test: {
          id: 'test-1',
          name: 'Routes billing requests',
          input: { message: 'I was charged twice' },
          errorBlockIds: ['router'],
          evaluator: { type: 'code', code: 'return true' },
        },
      })
    ).toMatchObject({
      suiteDefinitionRevision: 4,
      test: { id: 'test-1', errorBlockIds: ['router'] },
    })
  })

  it('rejects legacy agent definitions, duplicate criteria, and too many criteria', () => {
    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'agent',
        model: 'judge-model',
        criteria: 'The answer is useful',
      }).success
    ).toBe(false)

    const criterion = { id: 'same', name: 'Same', description: 'A defined criterion.' }
    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'agent',
        model: 'judge-model',
        criteria: [criterion, criterion],
        outputSelectors: [],
      }).success
    ).toBe(false)

    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'agent',
        model: 'judge-model',
        criteria: Array.from({ length: MAX_WORKFLOW_EVAL_CRITERIA + 1 }, (_, index) => ({
          id: `criterion-${index}`,
          name: `Criterion ${index}`,
          description: 'A defined criterion.',
        })),
        outputSelectors: [],
      }).success
    ).toBe(false)
  })

  it('rejects duplicate selectors and accepts explicit workflow-judge mappings', () => {
    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'code',
        code: 'return true',
        outputSelectors: [
          { blockId: 'router-1', path: 'route' },
          { blockId: 'router-1', path: 'route' },
        ],
      }).success
    ).toBe(false)

    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'agent',
        model: 'judge-model',
        criteria: [{ id: 'useful', name: 'Useful', description: 'Be useful.' }],
        outputSelectors: [
          { blockId: 'agent-1', path: 'content' },
          { blockId: 'agent-1', path: 'content' },
        ],
      }).success
    ).toBe(false)

    const evaluator = workflowEvalEvaluatorSchema.parse({
      type: 'workflow',
      workflowId: 'judge-workflow',
      inputMappings: [
        {
          inputName: 'answer',
          source: { type: 'subjectOutput', blockId: 'agent-1', path: 'content' },
        },
        {
          inputName: 'request',
          source: { type: 'testInput', path: '' },
        },
      ],
      scoreOutput: { blockId: 'score-1', path: 'score' },
    })

    expect(evaluator).toMatchObject({
      type: 'workflow',
      inputMappings: [
        { inputName: 'answer', source: { type: 'subjectOutput' } },
        { inputName: 'request', source: { type: 'testInput', path: '' } },
      ],
    })
  })

  it('rejects duplicate workflow target inputs and the old workflow definition', () => {
    expect(
      workflowEvalEvaluatorSchema.safeParse({
        type: 'workflow',
        workflowId: 'judge-workflow',
        inputMappings: [
          { inputName: 'answer', source: { type: 'testInput', path: 'one' } },
          { inputName: 'answer', source: { type: 'testInput', path: 'two' } },
        ],
        scoreOutput: { blockId: 'score-1', path: 'score' },
      }).success
    ).toBe(false)
    expect(
      workflowEvalEvaluatorSchema.safeParse({ type: 'workflow', workflowId: 'judge-workflow' })
        .success
    ).toBe(false)
  })

  it('requires version 1 on immutable definition snapshots', () => {
    const snapshot = {
      version: 1,
      suiteId: 'suite-1',
      name: 'Regression',
      tests: [
        {
          id: 'test-1',
          name: 'Test one',
          input: { message: 'Help me' },
          evaluator: { type: 'code', code: 'return true' },
        },
      ],
    }

    expect(workflowEvalDefinitionSnapshotSchema.parse(snapshot)).toMatchObject({ version: 1 })
    expect(
      workflowEvalDefinitionSnapshotSchema.safeParse({ ...snapshot, version: 2 }).success
    ).toBe(false)
    expect(
      workflowEvalDefinitionSnapshotSchema.safeParse({ ...snapshot, version: undefined }).success
    ).toBe(false)
  })

  it('rejects suites over the aggregate serialized byte limit', () => {
    const tests = Array.from({ length: 110 }, (_, index) => ({
      id: `test-${index}`,
      name: `Test ${index}`,
      input: null,
      evaluator: {
        type: 'code' as const,
        code: 'x'.repeat(100_000),
      },
    }))

    const result = workflowEvalTestsSchema.safeParse(tests)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected the oversized eval suite to be rejected')
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: `Eval suite must be at most ${MAX_WORKFLOW_EVAL_SUITE_BYTES} serialized bytes`,
      })
    )
  })
})

describe('workflow eval judge output', () => {
  it('accepts only a strict verdict, confidence, and bounded reason', () => {
    expect(
      workflowEvalCriterionJudgeOutputSchema.parse({
        verdict: 'warning',
        confidence: 0.82,
        reason: 'The response is useful but omits one requested detail.',
      })
    ).toMatchObject({ verdict: 'warning', confidence: 0.82 })

    expect(
      workflowEvalCriterionJudgeOutputSchema.safeParse({
        verdict: 'fail',
        confidence: 1,
        reason: 'x'.repeat(MAX_WORKFLOW_EVAL_JUDGE_REASON_CHARS + 1),
      }).success
    ).toBe(false)
    expect(
      workflowEvalCriterionJudgeOutputSchema.safeParse({
        verdict: 'warning',
        confidence: 1.01,
        reason: 'Too confident.',
      }).success
    ).toBe(false)
    expect(
      workflowEvalCriterionJudgeOutputSchema.safeParse({
        verdict: 'pass',
        confidence: 1,
        reason: 'Good.',
        chainOfThought: 'hidden',
      }).success
    ).toBe(false)
  })
})

describe('workflowEvalTestRunSchema', () => {
  it('separates lifecycle from normalized outcome and score', () => {
    expect(workflowEvalTestRunSchema.parse(codeTestRun())).toMatchObject({
      phase: 'completed',
      outcome: 'pass',
      score: 10,
    })

    expect(workflowEvalTestRunSchema.safeParse({ ...codeTestRun(), score: 9 }).success).toBe(false)
    expect(
      workflowEvalTestRunSchema.safeParse({
        ...codeTestRun(),
        phase: 'running_evaluator',
      }).success
    ).toBe(false)
  })

  it('enforces fixed outcome bands for graded evaluators', () => {
    const workflowRun = {
      ...codeTestRun(),
      evaluatorType: 'workflow' as const,
      score: 7.5,
      outcome: 'warning' as const,
      judgeExecutionId: 'judge-execution-1',
    }

    expect(workflowEvalTestRunSchema.parse(workflowRun)).toMatchObject({ outcome: 'warning' })
    expect(workflowEvalTestRunSchema.safeParse({ ...workflowRun, outcome: 'pass' }).success).toBe(
      false
    )
    expect(workflowEvalTestRunSchema.safeParse({ ...workflowRun, score: 11 }).success).toBe(false)
  })

  it('requires typed errors only on error-phase tests', () => {
    const errored = {
      ...codeTestRun(),
      phase: 'error' as const,
      outcome: null,
      score: null,
      error: TYPED_ERROR,
    }

    expect(workflowEvalTestRunSchema.parse(errored)).toMatchObject({ error: TYPED_ERROR })
    expect(workflowEvalTestRunSchema.safeParse({ ...errored, error: null }).success).toBe(false)
    expect(
      workflowEvalTestRunSchema.safeParse({ ...codeTestRun(), error: TYPED_ERROR }).success
    ).toBe(false)
  })

  it('requires every criterion result before an agent test can complete', () => {
    const agentRun = {
      ...codeTestRun(),
      evaluatorType: 'agent' as const,
      score: 8.2,
      outcome: 'pass' as const,
      criteria: [
        {
          id: 'criterion-run-1',
          criterionId: 'useful',
          name: 'Useful',
          ordinal: 0,
          phase: 'completed' as const,
          verdict: 'pass' as const,
          confidence: 0.82,
          error: null,
        },
      ],
    }

    expect(workflowEvalTestRunSchema.parse(agentRun)).toMatchObject({ evaluatorType: 'agent' })
    expect(
      workflowEvalTestRunSchema.safeParse({
        ...agentRun,
        criteria: [{ ...agentRun.criteria[0], phase: 'running', verdict: null, confidence: null }],
      }).success
    ).toBe(false)
  })

  it('keeps historical and current agent outcome semantics readable', () => {
    const agentRun = {
      ...codeTestRun(),
      evaluatorType: 'agent' as const,
      score: 5,
      outcome: 'warning' as const,
      criteria: [
        {
          id: 'criterion-run-1',
          criterionId: 'useful',
          name: 'Useful',
          ordinal: 0,
          phase: 'completed' as const,
          verdict: 'warning' as const,
          confidence: 1,
          error: null,
        },
      ],
    }

    expect(workflowEvalTestRunSchema.parse(agentRun)).toMatchObject({ outcome: 'warning' })
    expect(
      workflowEvalTestRunSchema.parse({
        ...agentRun,
        outcome: 'fail',
      })
    ).toMatchObject({ outcome: 'fail' })
  })
})

describe('workflowEvalLatestRunSchema', () => {
  it('requires revisioned terminal counts and exact snapshot-aligned test rows', () => {
    const run = {
      id: 'run-1',
      scope: 'suite' as const,
      selectedTestId: null,
      suiteDefinitionRevision: 1,
      status: 'completed' as const,
      revision: 4,
      completedCount: 1,
      passedCount: 1,
      warningCount: 0,
      failedCount: 0,
      errorCount: 0,
      totalCount: 1,
      ...RUN_TIMESTAMPS,
      completedAt: new Date('2026-07-16T12:00:02.000Z'),
      error: null,
      tests: [
        {
          id: 'test-1',
          name: 'Returns a useful answer',
          evaluatorType: 'code' as const,
        },
      ],
      testRuns: [codeTestRun()],
    }

    expect(workflowEvalLatestRunSchema.parse(run)).toMatchObject({ revision: 4, passedCount: 1 })
    expect(workflowEvalLatestRunSchema.safeParse({ ...run, passedCount: 0 }).success).toBe(false)
    expect(workflowEvalLatestRunSchema.safeParse({ ...run, testRuns: [] }).success).toBe(false)
    expect(
      workflowEvalLatestRunSchema.safeParse({
        ...run,
        testRuns: [{ ...codeTestRun(), testId: 'other-test' }],
      }).success
    ).toBe(false)
  })
})

describe('workflowEvalStreamEventSchema', () => {
  it('parses compact version 2 test upserts and rejects full definitions', () => {
    const event = {
      version: 2,
      type: 'eval.test.upsert',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      run: runningStreamRun(),
      test: {
        id: 'test-run-1',
        testId: 'test-1',
        ordinal: 0,
        evaluatorType: 'code',
        phase: 'completed',
        outcome: 'pass',
        score: 10,
        subjectExecutionId: 'execution-1',
        judgeExecutionId: null,
        error: null,
        criteria: [],
      },
    }

    expect(workflowEvalStreamEventSchema.parse(event)).toMatchObject({
      version: 2,
      run: { revision: 2 },
      test: { testId: 'test-1', score: 10 },
    })
    expect(workflowEvalStreamEventSchema.safeParse({ ...event, version: 1 }).success).toBe(false)
    expect(
      workflowEvalStreamEventSchema.safeParse({
        ...event,
        test: {
          ...event.test,
          input: { message: 'must not stream' },
          evaluator: { type: 'code', code: 'return true' },
        },
      }).success
    ).toBe(false)
  })

  it('supports compact criterion upserts with natural-language reasons but no names or evidence', () => {
    const event = {
      version: 2,
      type: 'eval.criterion.upsert',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      run: { ...runningStreamRun(), revision: 3 },
      testRunId: 'test-run-2',
      testId: 'test-2',
      criterion: {
        id: 'criterion-run-1',
        criterionId: 'useful',
        ordinal: 0,
        phase: 'completed',
        verdict: 'pass',
        confidence: 0.9,
        reason: 'The criterion passed.',
        error: null,
      },
    }

    expect(workflowEvalStreamEventSchema.parse(event)).toMatchObject({
      type: 'eval.criterion.upsert',
      criterion: { criterionId: 'useful', verdict: 'pass' },
    })
    expect(workflowEvalStreamEventSchema.parse(event).criterion).toMatchObject({
      reason: 'The criterion passed.',
    })
  })
})
