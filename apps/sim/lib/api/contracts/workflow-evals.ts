import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

const evalIdSchema = z.string().trim().min(1).max(128)
const evalNameSchema = z.string().trim().min(1).max(200)
const evalClientRefSchema = z.string().trim().min(1).max(128)
const evalPathSchema = z.string().max(1_000)
const evalErrorCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*$/, 'Eval error codes must be lowercase snake case')
const evalErrorMessageSchema = z.string().trim().min(1).max(20_000)
const MAX_EVAL_INPUT_BYTES = 1_000_000
export const MAX_WORKFLOW_EVAL_CRITERIA = 12
export const MAX_WORKFLOW_EVAL_OUTPUT_SELECTORS = 50
export const MAX_WORKFLOW_EVAL_INPUT_MAPPINGS = 50
export const MAX_WORKFLOW_EVAL_BLOCK_MOCKS = 100
export const MAX_WORKFLOW_EVAL_SUITE_BYTES = 10 * 1024 * 1024
export const MAX_WORKFLOW_EVAL_STREAM_EVENT_BYTES = 64 * 1024

export type WorkflowEvalJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkflowEvalJsonValue[]
  | { [key: string]: WorkflowEvalJsonValue }

export const workflowEvalJsonValueSchema: z.ZodType<WorkflowEvalJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(workflowEvalJsonValueSchema).max(1_000),
    z.record(z.string().min(1).max(500), workflowEvalJsonValueSchema),
  ])
)

export const workflowEvalInputSchema = workflowEvalJsonValueSchema.refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_EVAL_INPUT_BYTES,
  { message: `Eval input must be at most ${MAX_EVAL_INPUT_BYTES} serialized bytes` }
)

function uniqueBy<T>(items: readonly T[], getKey: (item: T) => string): boolean {
  return new Set(items.map(getKey)).size === items.length
}

function uniqueIds<T extends { id: string }>(items: readonly T[]): boolean {
  return uniqueBy(items, (item) => item.id)
}

export const workflowEvalOutputSelectorSchema = z
  .object({
    blockId: evalIdSchema,
    /** Empty selects the complete block output. */
    path: evalPathSchema,
  })
  .strict()

export type WorkflowEvalOutputSelector = z.output<typeof workflowEvalOutputSelectorSchema>

export const workflowEvalErrorBlockIdsSchema = z
  .array(evalIdSchema)
  .max(MAX_WORKFLOW_EVAL_OUTPUT_SELECTORS)
  .refine((blockIds) => new Set(blockIds).size === blockIds.length, {
    message: 'Eval error block ids must be unique',
  })

export type WorkflowEvalErrorBlockIds = z.output<typeof workflowEvalErrorBlockIdsSchema>

export const workflowEvalBlockMockSchema = z
  .object({
    blockId: evalIdSchema,
    output: workflowEvalInputSchema,
  })
  .strict()

export type WorkflowEvalBlockMock = z.output<typeof workflowEvalBlockMockSchema>

const workflowEvalBlockMocksSchema = z
  .array(workflowEvalBlockMockSchema)
  .max(MAX_WORKFLOW_EVAL_BLOCK_MOCKS)
  .refine((mocks) => uniqueBy(mocks, (mock) => mock.blockId), {
    message: 'Eval block mock ids must be unique',
  })

export const workflowEvalAgentCriterionSchema = z
  .object({
    id: evalIdSchema,
    name: evalNameSchema,
    description: z.string().trim().min(1).max(20_000),
  })
  .strict()

export type WorkflowEvalAgentCriterion = z.output<typeof workflowEvalAgentCriterionSchema>

const workflowEvalAgentCriteriaSchema = z
  .array(workflowEvalAgentCriterionSchema)
  .min(1)
  .max(MAX_WORKFLOW_EVAL_CRITERIA)
  .refine(uniqueIds, { message: 'Agent criterion ids must be unique' })

const workflowEvalOutputSelectorsSchema = z
  .array(workflowEvalOutputSelectorSchema)
  .max(MAX_WORKFLOW_EVAL_OUTPUT_SELECTORS)
  .refine(
    (selectors) => uniqueBy(selectors, ({ blockId, path }) => JSON.stringify([blockId, path])),
    { message: 'Agent output selectors must be unique' }
  )

export const workflowEvalWorkflowInputSourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('subjectOutput'),
      blockId: evalIdSchema,
      /** Empty selects the complete block output. */
      path: evalPathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('testInput'),
      /** Empty explicitly selects the complete original test input. */
      path: evalPathSchema,
    })
    .strict(),
])

export const workflowEvalWorkflowInputMappingSchema = z
  .object({
    inputName: evalNameSchema,
    source: workflowEvalWorkflowInputSourceSchema,
  })
  .strict()

export type WorkflowEvalWorkflowInputMapping = z.output<
  typeof workflowEvalWorkflowInputMappingSchema
>

const workflowEvalWorkflowInputMappingsSchema = z
  .array(workflowEvalWorkflowInputMappingSchema)
  .max(MAX_WORKFLOW_EVAL_INPUT_MAPPINGS)
  .refine((mappings) => uniqueBy(mappings, (mapping) => mapping.inputName), {
    message: 'Workflow judge input mapping targets must be unique',
  })

export const workflowEvalEvaluatorSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('code'),
      code: z.string().trim().min(1).max(100_000),
      outputSelectors: workflowEvalOutputSelectorsSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('agent'),
      model: z.string().trim().min(1).max(200),
      criteria: workflowEvalAgentCriteriaSchema,
      outputSelectors: workflowEvalOutputSelectorsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('workflow'),
      workflowId: evalIdSchema,
      inputMappings: workflowEvalWorkflowInputMappingsSchema,
      scoreOutput: workflowEvalOutputSelectorSchema,
    })
    .strict(),
])

export type WorkflowEvalEvaluator = z.output<typeof workflowEvalEvaluatorSchema>

export const workflowEvalTestSchema = z
  .object({
    id: evalIdSchema,
    name: evalNameSchema,
    /** Arbitrary JSON representing any workflow start condition. */
    input: workflowEvalInputSchema,
    mocks: workflowEvalBlockMocksSchema.optional(),
    errorBlockIds: workflowEvalErrorBlockIdsSchema.optional().default([]),
    evaluator: workflowEvalEvaluatorSchema,
  })
  .strict()

export type WorkflowEvalTest = z.output<typeof workflowEvalTestSchema>

const workflowEvalAuthoringCriterionSchema = z
  .object({
    clientRef: evalClientRefSchema,
    name: evalNameSchema,
    description: z.string().trim().min(1).max(20_000),
  })
  .strict()

const workflowEvalReplacementCriterionSchema = z.union([
  workflowEvalAgentCriterionSchema,
  workflowEvalAuthoringCriterionSchema,
])

function buildWorkflowEvalAuthoringEvaluatorSchema(
  criterionSchema:
    | typeof workflowEvalAuthoringCriterionSchema
    | typeof workflowEvalReplacementCriterionSchema
) {
  return z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('code'),
        code: z.string().trim().min(1).max(100_000),
        outputSelectors: workflowEvalOutputSelectorsSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('agent'),
        model: z.string().trim().min(1).max(200),
        criteria: z
          .array(criterionSchema)
          .min(1)
          .max(MAX_WORKFLOW_EVAL_CRITERIA)
          .refine(
            (criteria) =>
              uniqueBy(criteria, (criterion) =>
                'id' in criterion ? `id:${criterion.id}` : `ref:${criterion.clientRef}`
              ),
            { message: 'Agent criterion references must be unique' }
          ),
        outputSelectors: workflowEvalOutputSelectorsSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('workflow'),
        workflowId: evalIdSchema,
        inputMappings: workflowEvalWorkflowInputMappingsSchema,
        scoreOutput: workflowEvalOutputSelectorSchema,
      })
      .strict(),
  ])
}

export const workflowEvalCreateTestSchema = z
  .object({
    clientRef: evalClientRefSchema,
    name: evalNameSchema,
    input: workflowEvalInputSchema,
    mocks: workflowEvalBlockMocksSchema.optional(),
    errorBlockIds: workflowEvalErrorBlockIdsSchema.optional().default([]),
    evaluator: buildWorkflowEvalAuthoringEvaluatorSchema(workflowEvalAuthoringCriterionSchema),
  })
  .strict()

export type WorkflowEvalCreateTest = z.output<typeof workflowEvalCreateTestSchema>

export const workflowEvalReplaceTestSchema = z
  .object({
    testId: evalIdSchema,
    name: evalNameSchema,
    input: workflowEvalInputSchema,
    mocks: workflowEvalBlockMocksSchema.optional(),
    errorBlockIds: workflowEvalErrorBlockIdsSchema.optional().default([]),
    evaluator: buildWorkflowEvalAuthoringEvaluatorSchema(workflowEvalReplacementCriterionSchema),
  })
  .strict()

export type WorkflowEvalReplaceTest = z.output<typeof workflowEvalReplaceTestSchema>

export const workflowEvalAddTestSchema = workflowEvalCreateTestSchema
  .extend({ afterTestId: evalIdSchema.nullable().optional() })
  .strict()

export type WorkflowEvalAddTest = z.output<typeof workflowEvalAddTestSchema>

export const workflowEvalGeneratedIdsSchema = z
  .object({
    tests: z.record(evalClientRefSchema, evalIdSchema),
    criteria: z.record(z.string().trim().min(1).max(300), evalIdSchema),
  })
  .strict()

export type WorkflowEvalGeneratedIds = z.output<typeof workflowEvalGeneratedIdsSchema>

export const createWorkflowEvalSuiteInputSchema = z
  .object({
    workflowId: workflowIdSchema.optional(),
    name: evalNameSchema,
    tests: z
      .array(workflowEvalCreateTestSchema)
      .min(1)
      .max(1_000)
      .refine((tests) => uniqueBy(tests, (test) => test.clientRef), {
        message: 'Eval test clientRef values must be unique',
      }),
  })
  .strict()

export type CreateWorkflowEvalSuiteInput = z.output<typeof createWorkflowEvalSuiteInputSchema>

export const updateWorkflowEvalSuiteInputSchema = z
  .object({
    workflowId: workflowIdSchema.optional(),
    suiteId: evalIdSchema,
    expectedDefinitionRevision: z.number().int().min(1),
    renameTo: evalNameSchema.optional(),
    addTests: z.array(workflowEvalAddTestSchema).max(1_000).optional(),
    replaceTests: z.array(workflowEvalReplaceTestSchema).max(1_000).optional(),
    removeTestIds: z.array(evalIdSchema).max(1_000).optional(),
    orderedTestIds: z.array(evalIdSchema).min(1).max(1_000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.renameTo !== undefined ||
      Boolean(input.addTests?.length) ||
      Boolean(input.replaceTests?.length) ||
      Boolean(input.removeTestIds?.length) ||
      input.orderedTestIds !== undefined,
    { message: 'At least one suite change is required' }
  )

export type UpdateWorkflowEvalSuiteInput = z.output<typeof updateWorkflowEvalSuiteInputSchema>

export const archiveWorkflowEvalSuiteInputSchema = z
  .object({
    workflowId: workflowIdSchema.optional(),
    suiteId: evalIdSchema,
    expectedDefinitionRevision: z.number().int().min(1),
  })
  .strict()

export type ArchiveWorkflowEvalSuiteInput = z.output<typeof archiveWorkflowEvalSuiteInputSchema>

export const workflowEvalEvaluatorTypeSchema = z.enum(['code', 'agent', 'workflow'])

export type WorkflowEvalEvaluatorType = z.output<typeof workflowEvalEvaluatorTypeSchema>

export const workflowEvalCriterionSummarySchema = workflowEvalAgentCriterionSchema
  .pick({ id: true, name: true })
  .strict()

export type WorkflowEvalCriterionSummary = z.output<typeof workflowEvalCriterionSummarySchema>

export const workflowEvalTestSummarySchema = z.discriminatedUnion('evaluatorType', [
  z
    .object({
      id: evalIdSchema,
      name: evalNameSchema,
      evaluatorType: z.literal('code'),
    })
    .strict(),
  z
    .object({
      id: evalIdSchema,
      name: evalNameSchema,
      evaluatorType: z.literal('agent'),
      criteria: z
        .array(workflowEvalCriterionSummarySchema)
        .min(1)
        .max(MAX_WORKFLOW_EVAL_CRITERIA)
        .refine(uniqueIds, { message: 'Agent criterion summary ids must be unique' }),
    })
    .strict(),
  z
    .object({
      id: evalIdSchema,
      name: evalNameSchema,
      evaluatorType: z.literal('workflow'),
    })
    .strict(),
])

export type WorkflowEvalTestSummary = z.output<typeof workflowEvalTestSummarySchema>

export const workflowEvalTestSummariesSchema = z
  .array(workflowEvalTestSummarySchema)
  .max(1_000)
  .refine(uniqueIds, { message: 'Eval test summary ids must be unique' })

export const workflowEvalTestsSchema = z
  .array(workflowEvalTestSchema)
  .max(1_000)
  .refine(uniqueIds, { message: 'Eval test ids must be unique' })
  .refine(
    (tests) =>
      new TextEncoder().encode(JSON.stringify(tests)).byteLength <= MAX_WORKFLOW_EVAL_SUITE_BYTES,
    {
      message: `Eval suite must be at most ${MAX_WORKFLOW_EVAL_SUITE_BYTES} serialized bytes`,
    }
  )

export const workflowEvalDefinitionSnapshotSchema = z
  .object({
    version: z.literal(1),
    suiteId: evalIdSchema,
    name: evalNameSchema,
    tests: workflowEvalTestsSchema,
  })
  .strict()

export type WorkflowEvalDefinitionSnapshot = z.output<typeof workflowEvalDefinitionSnapshotSchema>

export const workflowEvalOutcomeSchema = z.enum(['pass', 'warning', 'fail'])

export type WorkflowEvalOutcome = z.output<typeof workflowEvalOutcomeSchema>

export const workflowEvalScoreSchema = z.number().finite().min(0).max(10)
export const workflowEvalConfidenceSchema = z.number().finite().min(0).max(1)
export const WORKFLOW_EVAL_AGENT_WARNING_CONFIDENCE_THRESHOLD = 0.5
export const MAX_WORKFLOW_EVAL_JUDGE_REASON_CHARS = 20_000

export const workflowEvalCriterionJudgeOutputSchema = z
  .object({
    verdict: workflowEvalOutcomeSchema,
    confidence: workflowEvalConfidenceSchema,
    reason: z.string().trim().min(1).max(MAX_WORKFLOW_EVAL_JUDGE_REASON_CHARS),
  })
  .strict()

export type WorkflowEvalCriterionJudgeOutput = z.output<
  typeof workflowEvalCriterionJudgeOutputSchema
>

export const workflowEvalErrorSchema = z
  .object({
    kind: z.enum(['subject', 'evaluator', 'infrastructure']),
    code: evalErrorCodeSchema,
    message: evalErrorMessageSchema,
  })
  .strict()

export type WorkflowEvalError = z.output<typeof workflowEvalErrorSchema>

export const workflowEvalRunErrorSchema = workflowEvalErrorSchema
  .extend({ kind: z.literal('infrastructure') })
  .strict()

export type WorkflowEvalRunError = z.output<typeof workflowEvalRunErrorSchema>

export const workflowEvalTestPhaseSchema = z.enum([
  'queued',
  'running_subject',
  'running_evaluator',
  'completed',
  'error',
])

export type WorkflowEvalTestPhase = z.output<typeof workflowEvalTestPhaseSchema>

export const workflowEvalCriterionPhaseSchema = z.enum(['queued', 'running', 'completed', 'error'])

export type WorkflowEvalCriterionPhase = z.output<typeof workflowEvalCriterionPhaseSchema>

interface OutcomeFields {
  phase: WorkflowEvalTestPhase
  outcome: WorkflowEvalOutcome | null
  score: number | null
  error: WorkflowEvalError | null
}

function validateTestOutcome(
  value: OutcomeFields & { evaluatorType: WorkflowEvalEvaluatorType },
  context: z.RefinementCtx
): void {
  if (value.phase === 'completed') {
    if (value.outcome === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed eval tests require an outcome',
        path: ['outcome'],
      })
    }
    if (value.score === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed eval tests require a score',
        path: ['score'],
      })
    }
    if (value.error !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed eval tests cannot contain an error',
        path: ['error'],
      })
    }
  } else if (value.phase === 'error') {
    if (value.outcome !== null || value.score !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Errored eval tests cannot contain an outcome or score',
        path: ['outcome'],
      })
    }
    if (value.error === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Errored eval tests require a typed error',
        path: ['error'],
      })
    }
  } else if (value.outcome !== null || value.score !== null || value.error !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Nonterminal eval tests cannot contain an outcome, score, or error',
      path: ['phase'],
    })
  }

  if (value.phase !== 'completed' || value.outcome === null || value.score === null) return

  if (value.evaluatorType === 'code') {
    const isValidCodeResult =
      (value.outcome === 'pass' && value.score === 10) ||
      (value.outcome === 'fail' && value.score === 0)
    if (!isValidCodeResult) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Code evaluators must normalize to pass/10 or fail/0',
        path: ['score'],
      })
    }
    return
  }

  if (value.evaluatorType === 'agent') return

  const expectedOutcome = value.score >= 8 ? 'pass' : value.score >= 5 ? 'warning' : 'fail'
  if (value.outcome !== expectedOutcome) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Score ${value.score} requires outcome ${expectedOutcome}`,
      path: ['outcome'],
    })
  }
}

interface CriterionOutcomeFields {
  phase: WorkflowEvalCriterionPhase
  verdict: WorkflowEvalOutcome | null
  confidence: number | null
  error: WorkflowEvalError | null
}

function validateCriterionOutcome(value: CriterionOutcomeFields, context: z.RefinementCtx): void {
  if (value.phase === 'completed') {
    if (value.verdict === null || value.confidence === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed criteria require a verdict and confidence',
        path: ['verdict'],
      })
    }
    if (value.error !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed criteria cannot contain an error',
        path: ['error'],
      })
    }
  } else if (value.phase === 'error') {
    if (value.verdict !== null || value.confidence !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Errored criteria cannot contain a verdict or confidence',
        path: ['verdict'],
      })
    }
    if (value.error === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Errored criteria require a typed error',
        path: ['error'],
      })
    }
  } else if (value.verdict !== null || value.confidence !== null || value.error !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Nonterminal criteria cannot contain a verdict, confidence, or error',
      path: ['phase'],
    })
  }
}

const workflowEvalCriterionRunBaseSchema = z
  .object({
    id: evalIdSchema,
    criterionId: evalIdSchema,
    ordinal: z
      .number()
      .int()
      .min(0)
      .max(MAX_WORKFLOW_EVAL_CRITERIA - 1),
    phase: workflowEvalCriterionPhaseSchema,
    verdict: workflowEvalOutcomeSchema.nullable(),
    confidence: workflowEvalConfidenceSchema.nullable(),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_WORKFLOW_EVAL_JUDGE_REASON_CHARS)
      .nullable()
      .optional()
      .default(null),
    error: workflowEvalErrorSchema.nullable(),
  })
  .strict()

export const workflowEvalCriterionRunSchema = workflowEvalCriterionRunBaseSchema
  .extend({ name: evalNameSchema })
  .strict()
  .superRefine(validateCriterionOutcome)

export type WorkflowEvalCriterionRun = z.output<typeof workflowEvalCriterionRunSchema>

export const workflowEvalCompactCriterionRunSchema =
  workflowEvalCriterionRunBaseSchema.superRefine(validateCriterionOutcome)

export type WorkflowEvalCompactCriterionRun = z.output<typeof workflowEvalCompactCriterionRunSchema>

const workflowEvalCriterionRunsSchema = z
  .array(workflowEvalCriterionRunSchema)
  .max(MAX_WORKFLOW_EVAL_CRITERIA)
  .refine((criteria) => uniqueBy(criteria, (criterion) => criterion.id), {
    message: 'Criterion run ids must be unique',
  })
  .refine((criteria) => uniqueBy(criteria, (criterion) => criterion.criterionId), {
    message: 'Criterion definition ids must be unique within a test run',
  })
  .refine((criteria) => uniqueBy(criteria, (criterion) => String(criterion.ordinal)), {
    message: 'Criterion ordinals must be unique within a test run',
  })

const workflowEvalCompactCriterionRunsSchema = z
  .array(workflowEvalCompactCriterionRunSchema)
  .max(MAX_WORKFLOW_EVAL_CRITERIA)
  .refine((criteria) => uniqueBy(criteria, (criterion) => criterion.id), {
    message: 'Compact criterion run ids must be unique',
  })
  .refine((criteria) => uniqueBy(criteria, (criterion) => criterion.criterionId), {
    message: 'Compact criterion definition ids must be unique within a test run',
  })
  .refine((criteria) => uniqueBy(criteria, (criterion) => String(criterion.ordinal)), {
    message: 'Compact criterion ordinals must be unique within a test run',
  })

const workflowEvalTestRunBaseShape = {
  id: evalIdSchema,
  testId: evalIdSchema,
  ordinal: z.number().int().min(0).max(999),
  phase: workflowEvalTestPhaseSchema,
  outcome: workflowEvalOutcomeSchema.nullable(),
  score: workflowEvalScoreSchema.nullable(),
  reason: z.string().trim().min(1).max(20_000).nullable().optional().default(null),
  errorBlockIds: workflowEvalErrorBlockIdsSchema.optional().default([]),
  subjectExecutionId: evalIdSchema,
  judgeExecutionId: evalIdSchema.nullable(),
  error: workflowEvalErrorSchema.nullable(),
} as const

interface TestRunRefinementFields extends OutcomeFields {
  evaluatorType: WorkflowEvalEvaluatorType
  subjectExecutionId: string
  judgeExecutionId: string | null
  criteria: ReadonlyArray<{ phase: WorkflowEvalCriterionPhase }>
}

function validateTestRun(value: TestRunRefinementFields, context: z.RefinementCtx): void {
  validateTestOutcome(value, context)

  if (value.evaluatorType !== 'workflow' && value.judgeExecutionId !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only workflow evaluators may have a judge execution id',
      path: ['judgeExecutionId'],
    })
  }
  if (value.evaluatorType === 'workflow' && value.judgeExecutionId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Workflow evaluators require a preallocated judge execution id',
      path: ['judgeExecutionId'],
    })
  }
  if (
    value.phase === 'completed' &&
    value.evaluatorType === 'agent' &&
    (value.criteria.length === 0 ||
      value.criteria.some((criterion) => criterion.phase !== 'completed'))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Completed agent evaluators require completed criterion runs',
      path: ['criteria'],
    })
  }
}

export const workflowEvalTestRunSchema = z
  .discriminatedUnion('evaluatorType', [
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        name: evalNameSchema,
        evaluatorType: z.literal('code'),
        criteria: z.tuple([]),
      })
      .strict(),
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        name: evalNameSchema,
        evaluatorType: z.literal('agent'),
        criteria: workflowEvalCriterionRunsSchema,
      })
      .strict(),
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        name: evalNameSchema,
        evaluatorType: z.literal('workflow'),
        criteria: z.tuple([]),
      })
      .strict(),
  ])
  .superRefine(validateTestRun)

export type WorkflowEvalTestRun = z.output<typeof workflowEvalTestRunSchema>

export const workflowEvalCompactTestRunSchema = z
  .discriminatedUnion('evaluatorType', [
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        evaluatorType: z.literal('code'),
        criteria: z.tuple([]),
      })
      .strict(),
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        evaluatorType: z.literal('agent'),
        criteria: workflowEvalCompactCriterionRunsSchema,
      })
      .strict(),
    z
      .object({
        ...workflowEvalTestRunBaseShape,
        evaluatorType: z.literal('workflow'),
        criteria: z.tuple([]),
      })
      .strict(),
  ])
  .superRefine(validateTestRun)

export type WorkflowEvalCompactTestRun = z.output<typeof workflowEvalCompactTestRunSchema>

export const workflowEvalTestRunsSchema = z
  .array(workflowEvalTestRunSchema)
  .max(1_000)
  .refine((runs) => uniqueBy(runs, (run) => run.id), { message: 'Test run ids must be unique' })
  .refine((runs) => uniqueBy(runs, (run) => run.testId), {
    message: 'A run cannot contain multiple rows for the same test',
  })
  .refine((runs) => uniqueBy(runs, (run) => String(run.ordinal)), {
    message: 'Test ordinals must be unique within a run',
  })

export const workflowEvalRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'error',
  'cancelled',
])

export type WorkflowEvalRunStatus = z.output<typeof workflowEvalRunStatusSchema>

export const workflowEvalRunScopeSchema = z.enum(['suite', 'test'])

export type WorkflowEvalRunScope = z.output<typeof workflowEvalRunScopeSchema>

const workflowEvalRunBaseSchema = z
  .object({
    id: evalIdSchema,
    scope: workflowEvalRunScopeSchema,
    selectedTestId: evalIdSchema.nullable(),
    suiteDefinitionRevision: z.number().int().min(1),
    status: workflowEvalRunStatusSchema,
    revision: z.number().int().min(0),
    completedCount: z.number().int().min(0),
    passedCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    totalCount: z.number().int().min(0).max(1_000),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    error: workflowEvalRunErrorSchema.nullable(),
  })
  .strict()

type WorkflowEvalRunBase = z.output<typeof workflowEvalRunBaseSchema>

function validateRun(run: WorkflowEvalRunBase, context: z.RefinementCtx): void {
  if ((run.scope === 'suite') !== (run.selectedTestId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only test-scoped runs may select exactly one test',
      path: ['selectedTestId'],
    })
  }
  const terminalCount = run.passedCount + run.warningCount + run.failedCount + run.errorCount
  if (terminalCount !== run.completedCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'completedCount must equal the sum of terminal outcome counts',
      path: ['completedCount'],
    })
  }
  if (run.completedCount > run.totalCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Terminal eval counts cannot exceed totalCount',
      path: ['completedCount'],
    })
  }
  if (run.status === 'queued' && run.completedCount !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Queued eval runs cannot contain terminal results',
      path: ['completedCount'],
    })
  }
  if (run.status === 'completed' && run.completedCount !== run.totalCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Completed eval runs require one terminal result per test',
      path: ['status'],
    })
  }

  const terminal =
    run.status === 'completed' || run.status === 'error' || run.status === 'cancelled'
  if (terminal !== (run.completedAt !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Eval run completion timestamp must match terminal lifecycle',
      path: ['completedAt'],
    })
  }
  if ((run.status === 'running' || run.status === 'completed') && run.startedAt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${run.status} eval runs require a start timestamp`,
      path: ['startedAt'],
    })
  }
  if (run.status === 'error' && run.error === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Errored eval runs require a typed error',
      path: ['error'],
    })
  }
  if (run.status !== 'error' && run.error !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only errored eval runs may contain an error',
      path: ['error'],
    })
  }
  if (run.updatedAt.getTime() < run.createdAt.getTime()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'updatedAt cannot precede createdAt',
      path: ['updatedAt'],
    })
  }
}

export const workflowEvalStreamRunSchema = workflowEvalRunBaseSchema.superRefine(validateRun)

export type WorkflowEvalStreamRun = z.output<typeof workflowEvalStreamRunSchema>

function validateLatestRun(
  run: WorkflowEvalRunBase & {
    tests: WorkflowEvalTestSummary[]
    testRuns: WorkflowEvalTestRun[]
  },
  context: z.RefinementCtx
): void {
  validateRun(run, context)

  if (run.tests.length !== run.totalCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Eval run test summaries must match totalCount',
      path: ['tests'],
    })
  }
  if (run.testRuns.length !== run.totalCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Eval run test rows must match totalCount',
      path: ['testRuns'],
    })
  }

  for (const testRun of run.testRuns) {
    const summary = run.tests[testRun.ordinal]
    if (
      !summary ||
      summary.id !== testRun.testId ||
      summary.name !== testRun.name ||
      summary.evaluatorType !== testRun.evaluatorType
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Test run ${testRun.id} does not match its ordinal definition snapshot`,
        path: ['testRuns', testRun.ordinal],
      })
      continue
    }

    if (summary.evaluatorType === 'agent' && testRun.evaluatorType === 'agent') {
      const criteriaMatch =
        summary.criteria.length === testRun.criteria.length &&
        summary.criteria.every((criterion, ordinal) => {
          const criterionRun = testRun.criteria[ordinal]
          return (
            criterionRun?.ordinal === ordinal &&
            criterionRun.criterionId === criterion.id &&
            criterionRun.name === criterion.name
          )
        })
      if (!criteriaMatch) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent test run ${testRun.id} criteria do not match its definition snapshot`,
          path: ['testRuns', testRun.ordinal, 'criteria'],
        })
      }
    }
  }
}

export const workflowEvalLatestRunSchema = workflowEvalRunBaseSchema
  .extend({
    tests: workflowEvalTestSummariesSchema,
    testRuns: workflowEvalTestRunsSchema,
  })
  .strict()
  .superRefine(validateLatestRun)

export type WorkflowEvalLatestRun = z.output<typeof workflowEvalLatestRunSchema>

export const workflowEvalSuiteSchema = z
  .object({
    id: evalIdSchema,
    name: evalNameSchema,
    definitionRevision: z.number().int().min(1),
    archivedAt: z.coerce.date().nullable(),
    tests: workflowEvalTestSummariesSchema,
    testCount: z.number().int().min(0).max(1_000),
    latestRun: workflowEvalLatestRunSchema.nullable(),
    latestSuiteRun: workflowEvalLatestRunSchema.nullable(),
  })
  .strict()
  .refine((suite) => suite.tests.length === suite.testCount, {
    message: 'Eval suite test summaries must match testCount',
    path: ['tests'],
  })

export type WorkflowEvalSuite = z.output<typeof workflowEvalSuiteSchema>

export const workflowEvalSuitesResponseSchema = z
  .object({
    enabled: z.boolean(),
    suites: z.array(workflowEvalSuiteSchema).max(1_000),
  })
  .strict()

export const workflowEvalSuiteParamsSchema = workflowIdParamsSchema
  .extend({
    suiteId: evalIdSchema,
  })
  .strict()

export type StartWorkflowEvalSuiteRunParams = z.input<typeof workflowEvalSuiteParamsSchema>

export const workflowEvalRunParamsSchema = workflowEvalSuiteParamsSchema
  .extend({
    runId: evalIdSchema,
  })
  .strict()

export const workflowEvalRunTestParamsSchema = workflowEvalRunParamsSchema
  .extend({
    testId: evalIdSchema,
  })
  .strict()

export const startWorkflowEvalSuiteRunResponseSchema = z
  .object({
    runId: evalIdSchema,
    suiteId: evalIdSchema,
    workspaceId: workspaceIdSchema,
    workflowId: workflowIdSchema,
    scope: workflowEvalRunScopeSchema,
    selectedTestId: evalIdSchema.nullable(),
    suiteDefinitionRevision: z.number().int().min(1),
    status: z.literal('queued'),
    revision: z.literal(0),
    totalCount: z.number().int().min(0).max(1_000),
    createdAt: z.coerce.date(),
  })
  .strict()

export const stopWorkflowEvalRunResponseSchema = z
  .object({
    runId: evalIdSchema,
    suiteId: evalIdSchema,
    workspaceId: workspaceIdSchema,
    workflowId: workflowIdSchema,
    status: z.literal('cancelled'),
    revision: z.number().int().min(1),
    completedAt: z.coerce.date(),
  })
  .strict()

export const getWorkflowEvalSuitesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/evals',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: workflowEvalSuitesResponseSchema,
  },
})

export type WorkflowEvalSuitesResponse = ContractJsonResponse<typeof getWorkflowEvalSuitesContract>

export const startWorkflowEvalRunBodySchema = z
  .object({
    testId: evalIdSchema.optional(),
    expectedDefinitionRevision: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.testId && body.expectedDefinitionRevision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedDefinitionRevision'],
        message: 'expectedDefinitionRevision is required when testId is provided',
      })
    }
  })

export type StartWorkflowEvalRunBody = z.input<typeof startWorkflowEvalRunBodySchema>

export const startWorkflowEvalSuiteRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/evals/suites/[suiteId]/runs',
  params: workflowEvalSuiteParamsSchema,
  body: startWorkflowEvalRunBodySchema,
  response: {
    mode: 'json',
    schema: startWorkflowEvalSuiteRunResponseSchema,
  },
})

export type StartWorkflowEvalSuiteRunResponse = ContractJsonResponse<
  typeof startWorkflowEvalSuiteRunContract
>

export const stopWorkflowEvalRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/evals/suites/[suiteId]/runs/[runId]/stop',
  params: workflowEvalRunParamsSchema,
  response: {
    mode: 'json',
    schema: stopWorkflowEvalRunResponseSchema,
  },
})

export type StopWorkflowEvalRunResponse = ContractJsonResponse<typeof stopWorkflowEvalRunContract>

export const workflowEvalRunTestDefinitionResponseSchema = z
  .object({
    runId: evalIdSchema,
    suiteId: evalIdSchema,
    suiteDefinitionRevision: z.number().int().min(1),
    test: workflowEvalTestSchema,
  })
  .strict()

export const getWorkflowEvalRunTestDefinitionContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/evals/suites/[suiteId]/runs/[runId]/tests/[testId]',
  params: workflowEvalRunTestParamsSchema,
  response: {
    mode: 'json',
    schema: workflowEvalRunTestDefinitionResponseSchema,
  },
})

export type WorkflowEvalRunTestDefinitionResponse = ContractJsonResponse<
  typeof getWorkflowEvalRunTestDefinitionContract
>

const workflowEvalStreamEventBaseSchema = z.object({
  version: z.literal(2),
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  suiteId: evalIdSchema,
  run: workflowEvalStreamRunSchema,
})

export const workflowEvalStreamEventSchema = z
  .discriminatedUnion('type', [
    workflowEvalStreamEventBaseSchema
      .extend({
        type: z.literal('eval.run.upsert'),
      })
      .strict(),
    workflowEvalStreamEventBaseSchema
      .extend({
        type: z.literal('eval.test.upsert'),
        test: workflowEvalCompactTestRunSchema,
      })
      .strict(),
    workflowEvalStreamEventBaseSchema
      .extend({
        type: z.literal('eval.criterion.upsert'),
        testRunId: evalIdSchema,
        testId: evalIdSchema,
        criterion: workflowEvalCompactCriterionRunSchema,
      })
      .strict(),
  ])
  .refine(
    (event) =>
      new TextEncoder().encode(JSON.stringify(event)).byteLength <=
      MAX_WORKFLOW_EVAL_STREAM_EVENT_BYTES,
    {
      message: `Workflow eval stream events must be at most ${MAX_WORKFLOW_EVAL_STREAM_EVENT_BYTES} serialized bytes`,
    }
  )

export type WorkflowEvalStreamEvent = z.output<typeof workflowEvalStreamEventSchema>

export const streamWorkflowEvalsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/evals/stream',
  params: workflowIdParamsSchema,
  response: {
    mode: 'stream',
  },
})
