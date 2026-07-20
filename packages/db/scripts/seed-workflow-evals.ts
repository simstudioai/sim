/// <reference types="node" />

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNull } from 'drizzle-orm'

const logger = createLogger('SeedWorkflowEvals')

const SUPPORT_SUITE_NAME = 'Customer Support Regression'
const READY_SUITE_NAME = 'Safety Checks'
const MULTI_ROW_SUITE_NAME = 'Multi-row Coverage'
const AGENT_SUITE_NAME = 'Agent Judge Smoke'
const WORKFLOW_SUITE_NAME = 'Workflow Judge Smoke'
const JUDGE_WORKFLOW_NAME_PREFIX = 'Eval Judge Smoke'
const JUDGE_WORKFLOW_DESCRIPTION_PREFIX = 'Development-only workflow eval judge for'
const JUDGE_SCORE_BLOCK_NAME = 'Score'
const JUDGE_CODE = `const testInput = <start.testInput>
if (typeof testInput?.judgeScore !== 'number') {
  throw new Error('judgeScore must be a number')
}
return testInput.judgeScore`
const FIXTURE_SUITE_NAMES = [
  SUPPORT_SUITE_NAME,
  READY_SUITE_NAME,
  MULTI_ROW_SUITE_NAME,
  AGENT_SUITE_NAME,
  WORKFLOW_SUITE_NAME,
] as const

interface SeedArgs {
  workflowId: string
}

interface EvalTestDefinition {
  id: string
  name: string
  input: Record<string, unknown>
  evaluator:
    | {
        type: 'code'
        code: string
      }
    | {
        type: 'agent'
        model: string
        criteria: Array<{ id: string; name: string; description: string }>
        outputSelectors: Array<{ blockId: string; path: string }>
      }
    | {
        type: 'workflow'
        workflowId: string
        inputMappings: Array<{
          inputName: string
          source: { type: 'testInput'; path: string }
        }>
        scoreOutput: { blockId: string; path: string }
      }
}

interface JudgeWorkflowFixture {
  workflowId: string
  scoreBlockId: string
}

interface WorkflowJudgeCase {
  name: string
  message: string
  judgeScore: number
}

const WORKFLOW_JUDGE_CASES: readonly WorkflowJudgeCase[] = [
  {
    name: 'Workflow judge pass',
    message: 'Fixture request expected to pass workflow judging',
    judgeScore: 10,
  },
  {
    name: 'Workflow judge warning',
    message: 'Fixture request expected to warn workflow judging',
    judgeScore: 7,
  },
  {
    name: 'Workflow judge fail',
    message: 'Fixture request expected to fail workflow judging',
    judgeScore: 2,
  },
] as const

function readSubBlockValue(subBlocks: unknown, key: string): unknown {
  if (!isRecordLike(subBlocks) || !isRecordLike(subBlocks[key])) {
    throw new Error(`Judge workflow block is missing sub-block ${key}`)
  }
  return subBlocks[key].value
}

function assertJudgeStartBlock(subBlocks: unknown, outputs: unknown): void {
  const inputFormat = readSubBlockValue(subBlocks, 'inputFormat')
  if (!Array.isArray(inputFormat) || inputFormat.length !== 1) {
    throw new Error('Judge workflow Start block must define exactly one input field')
  }
  const [field] = inputFormat
  if (
    !isRecordLike(field) ||
    typeof field.id !== 'string' ||
    field.id.length === 0 ||
    field.name !== 'testInput' ||
    field.type !== 'object' ||
    field.value !== '' ||
    field.collapsed !== false
  ) {
    throw new Error('Judge workflow Start block testInput field has drifted')
  }
  if (readSubBlockValue(subBlocks, 'runMetadata') !== false) {
    throw new Error('Judge workflow Start block runMetadata setting has drifted')
  }
  if (!isRecordLike(outputs) || !isRecordLike(outputs.testInput)) {
    throw new Error('Judge workflow Start block testInput output is missing')
  }
}

function assertJudgeScoreBlock(subBlocks: unknown, outputs: unknown): void {
  if (readSubBlockValue(subBlocks, 'language') !== 'javascript') {
    throw new Error('Judge workflow Score block language has drifted')
  }
  if (readSubBlockValue(subBlocks, 'code') !== JUDGE_CODE) {
    throw new Error('Judge workflow Score block code has drifted')
  }
  if (!isRecordLike(outputs) || !isRecordLike(outputs.result)) {
    throw new Error('Judge workflow Score block result output is missing')
  }
}

function buildWorkflowJudgeTests({
  workflowId,
  scoreBlockId,
}: JudgeWorkflowFixture): EvalTestDefinition[] {
  return WORKFLOW_JUDGE_CASES.map(({ name, message, judgeScore }) => ({
    id: generateId(),
    name,
    input: { message, channel: 'slack', judgeScore },
    evaluator: {
      type: 'workflow',
      workflowId,
      inputMappings: [
        {
          inputName: 'testInput',
          source: { type: 'testInput', path: '' },
        },
      ],
      scoreOutput: { blockId: scoreBlockId, path: 'result' },
    },
  }))
}

function assertWorkflowJudgeSuite(
  tests: unknown,
  { workflowId, scoreBlockId }: JudgeWorkflowFixture
): void {
  if (!Array.isArray(tests) || tests.length !== WORKFLOW_JUDGE_CASES.length) {
    throw new Error(`Existing ${WORKFLOW_SUITE_NAME} suite has drifted`)
  }

  for (const expected of WORKFLOW_JUDGE_CASES) {
    const test = tests.find(
      (candidate) => isRecordLike(candidate) && candidate.name === expected.name
    )
    if (!isRecordLike(test) || typeof test.id !== 'string' || test.id.length === 0) {
      throw new Error(`Existing ${WORKFLOW_SUITE_NAME} suite is missing ${expected.name}`)
    }
    if (!isRecordLike(test.input)) {
      throw new Error(`Existing ${expected.name} input has drifted`)
    }
    const inputKeys = Object.keys(test.input).sort()
    if (
      inputKeys.join(',') !== 'channel,judgeScore,message' ||
      test.input.channel !== 'slack' ||
      test.input.message !== expected.message ||
      test.input.judgeScore !== expected.judgeScore
    ) {
      throw new Error(`Existing ${expected.name} input has drifted`)
    }
    if (!isRecordLike(test.evaluator) || test.evaluator.type !== 'workflow') {
      throw new Error(`Existing ${expected.name} evaluator has drifted`)
    }
    const evaluator = test.evaluator
    if (evaluator.workflowId !== workflowId || !Array.isArray(evaluator.inputMappings)) {
      throw new Error(`Existing ${expected.name} workflow target has drifted`)
    }
    if (evaluator.inputMappings.length !== 1) {
      throw new Error(`Existing ${expected.name} input mappings have drifted`)
    }
    const [mapping] = evaluator.inputMappings
    if (
      !isRecordLike(mapping) ||
      mapping.inputName !== 'testInput' ||
      !isRecordLike(mapping.source) ||
      mapping.source.type !== 'testInput' ||
      mapping.source.path !== ''
    ) {
      throw new Error(`Existing ${expected.name} input mapping has drifted`)
    }
    if (
      !isRecordLike(evaluator.scoreOutput) ||
      evaluator.scoreOutput.blockId !== scoreBlockId ||
      evaluator.scoreOutput.path !== 'result'
    ) {
      throw new Error(`Existing ${expected.name} score output has drifted`)
    }
  }
}

function parseArgs(argv: string[]): SeedArgs {
  const values = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag || !value || !flag.startsWith('--')) {
      throw new Error('Usage: seed-workflow-evals.ts --workflow-id <id>')
    }
    if (flag !== '--workflow-id') {
      throw new Error(`Unknown argument: ${flag}`)
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}`)
    }
    values.set(flag, value)
  }

  const workflowId = values.get('--workflow-id')?.trim()
  if (!workflowId || values.size !== 1) {
    throw new Error('--workflow-id is required')
  }

  return { workflowId }
}

function buildTests(count: number, prefix: string): EvalTestDefinition[] {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1
    return {
      id: generateId(),
      name: `${prefix} ${position}`,
      input: {
        message: `Fixture request ${position}`,
        channel: 'slack',
      },
      evaluator: {
        type: 'code',
        code:
          position % 5 === 0
            ? `return { passed: false, reason: 'Fixture assertion ${position} intentionally failed' }`
            : 'return output !== null && output !== undefined',
      },
    }
  })
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Workflow eval fixtures may only be seeded with NODE_ENV=development')
  }

  const { workflowId } = parseArgs(process.argv.slice(2))
  const { db, workflow, workflowBlocks, workflowEdges, workflowEvalSuite } = await import('@sim/db')

  const supportTests = buildTests(15, 'Support scenario')
  const readyTests = buildTests(8, 'Safety scenario')
  const multiRowTests = buildTests(100, 'Volume scenario')
  const agentTests: EvalTestDefinition[] = [
    {
      id: generateId(),
      name: 'Trace quality review',
      input: { message: 'Fixture request for agent judging', channel: 'slack' },
      evaluator: {
        type: 'agent',
        model: 'gpt-4.1-mini',
        criteria: [
          {
            id: 'completion-integrity',
            name: 'Completion integrity',
            description: 'The workflow completed through a coherent sequence of executed blocks.',
          },
          {
            id: 'error-handling',
            name: 'Error handling',
            description: 'The execution has no unhandled block errors.',
          },
          {
            id: 'execution-efficiency',
            name: 'Execution efficiency',
            description: 'The workflow avoided obviously redundant or repeated execution steps.',
          },
        ],
        outputSelectors: [],
      },
    },
    {
      id: generateId(),
      name: 'Mixed verdict review',
      input: { message: 'Fixture request for a mixed Agent judgment', channel: 'slack' },
      evaluator: {
        type: 'agent',
        model: 'gpt-4.1-mini',
        criteria: [
          {
            id: 'mixed-completion-present',
            name: 'Successful completion present',
            description:
              'Pass if the trace is finalized successfully and contains at least one successfully executed workflow block.',
          },
          {
            id: 'mixed-impossible-block',
            name: 'Required synthetic block present',
            description:
              'Pass only if the trace contains a successfully executed block whose exact name is "__eval_required_missing_block__".',
          },
        ],
        outputSelectors: [],
      },
    },
    {
      id: generateId(),
      name: 'Expected failure review',
      input: { message: 'Fixture request for a failing Agent judgment', channel: 'slack' },
      evaluator: {
        type: 'agent',
        model: 'gpt-4.1-mini',
        criteria: [
          {
            id: 'failure-impossible-block',
            name: 'Required synthetic block present',
            description:
              'Pass only if the trace contains a successfully executed block whose exact name is "__eval_required_missing_block__".',
          },
          {
            id: 'failure-impossible-tool',
            name: 'Required synthetic tool call present',
            description:
              'Pass only if the trace contains a successfully executed Agent tool call whose exact name is "__eval_required_missing_tool__".',
          },
        ],
        outputSelectors: [],
      },
    },
  ]

  const seedResult = await db.transaction(async (tx) => {
    const [workflowRow] = await tx
      .select({
        id: workflow.id,
        workspaceId: workflow.workspaceId,
        userId: workflow.userId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }
    if (!workflowRow.workspaceId) {
      throw new Error(`Workflow is not attached to a workspace: ${workflowId}`)
    }

    const now = new Date()
    const judgeWorkflowName = `${JUDGE_WORKFLOW_NAME_PREFIX} (${workflowId})`
    const judgeWorkflowDescription = `${JUDGE_WORKFLOW_DESCRIPTION_PREFIX} ${workflowId}`
    const existingJudgeRows = await tx
      .select({ id: workflow.id, description: workflow.description })
      .from(workflow)
      .where(
        and(
          eq(workflow.workspaceId, workflowRow.workspaceId),
          eq(workflow.name, judgeWorkflowName),
          isNull(workflow.folderId),
          isNull(workflow.archivedAt)
        )
      )
      .limit(2)
    if (existingJudgeRows.length > 1) {
      throw new Error(`Multiple active judge workflows exist for ${workflowId}`)
    }

    let judgeFixture: JudgeWorkflowFixture
    const existingJudge = existingJudgeRows[0]
    if (!existingJudge) {
      const judgeWorkflowId = generateId()
      const startBlockId = generateId()
      const scoreBlockId = generateId()

      await tx.insert(workflow).values({
        id: judgeWorkflowId,
        userId: workflowRow.userId,
        workspaceId: workflowRow.workspaceId,
        folderId: null,
        name: judgeWorkflowName,
        description: judgeWorkflowDescription,
        variables: {},
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(workflowBlocks).values([
        {
          id: startBlockId,
          workflowId: judgeWorkflowId,
          type: 'start_trigger',
          name: 'Start',
          positionX: '0',
          positionY: '0',
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          height: '0',
          subBlocks: {
            inputFormat: {
              id: 'inputFormat',
              type: 'input-format',
              value: [
                {
                  id: generateId(),
                  name: 'testInput',
                  type: 'object',
                  value: '',
                  collapsed: false,
                },
              ],
            },
            runMetadata: { id: 'runMetadata', type: 'switch', value: false },
          },
          outputs: {
            input: { type: 'string', description: 'Primary user input or message' },
            conversationId: {
              type: 'string',
              description: 'Conversation thread identifier',
            },
            files: { type: 'file[]', description: 'User uploaded files' },
            testInput: { type: 'object', description: 'Field from input format' },
          },
          data: {},
          createdAt: now,
          updatedAt: now,
        },
        {
          id: scoreBlockId,
          workflowId: judgeWorkflowId,
          type: 'function',
          name: JUDGE_SCORE_BLOCK_NAME,
          positionX: '400',
          positionY: '0',
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          height: '0',
          subBlocks: {
            language: { id: 'language', type: 'dropdown', value: 'javascript' },
            code: { id: 'code', type: 'code', value: JUDGE_CODE },
          },
          outputs: {
            result: {
              type: 'json',
              description: 'Return value from the executed JavaScript function',
            },
            stdout: {
              type: 'string',
              description: 'Console log output and debug messages from function execution',
            },
          },
          data: {},
          createdAt: now,
          updatedAt: now,
        },
      ])
      await tx.insert(workflowEdges).values({
        id: generateId(),
        workflowId: judgeWorkflowId,
        sourceBlockId: startBlockId,
        targetBlockId: scoreBlockId,
        sourceHandle: null,
        targetHandle: null,
        createdAt: now,
      })
      judgeFixture = { workflowId: judgeWorkflowId, scoreBlockId }
    } else {
      if (existingJudge.description !== judgeWorkflowDescription) {
        throw new Error(`Existing judge workflow ${existingJudge.id} has an unexpected description`)
      }
      const judgeBlocks = await tx
        .select({
          id: workflowBlocks.id,
          type: workflowBlocks.type,
          name: workflowBlocks.name,
          subBlocks: workflowBlocks.subBlocks,
          outputs: workflowBlocks.outputs,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, existingJudge.id))
        .limit(3)
      if (judgeBlocks.length !== 2) {
        throw new Error(
          `Existing judge workflow ${existingJudge.id} must contain exactly two blocks`
        )
      }
      const startBlock = judgeBlocks.find(
        ({ type, name }) => type === 'start_trigger' && name === 'Start'
      )
      const scoreBlock = judgeBlocks.find(
        ({ type, name }) => type === 'function' && name === JUDGE_SCORE_BLOCK_NAME
      )
      if (!startBlock || !scoreBlock) {
        throw new Error(`Existing judge workflow ${existingJudge.id} graph has drifted`)
      }
      assertJudgeStartBlock(startBlock.subBlocks, startBlock.outputs)
      assertJudgeScoreBlock(scoreBlock.subBlocks, scoreBlock.outputs)

      const judgeEdges = await tx
        .select({
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
          sourceHandle: workflowEdges.sourceHandle,
          targetHandle: workflowEdges.targetHandle,
        })
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, existingJudge.id))
        .limit(2)
      const [judgeEdge] = judgeEdges
      if (
        judgeEdges.length !== 1 ||
        !judgeEdge ||
        judgeEdge.sourceBlockId !== startBlock.id ||
        judgeEdge.targetBlockId !== scoreBlock.id ||
        judgeEdge.sourceHandle !== null ||
        judgeEdge.targetHandle !== null
      ) {
        throw new Error(`Existing judge workflow ${existingJudge.id} edge has drifted`)
      }
      judgeFixture = { workflowId: existingJudge.id, scoreBlockId: scoreBlock.id }
    }

    const workflowJudgeTests = buildWorkflowJudgeTests(judgeFixture)

    const existingSuites = await tx
      .select({ name: workflowEvalSuite.name, tests: workflowEvalSuite.tests })
      .from(workflowEvalSuite)
      .where(
        and(
          eq(workflowEvalSuite.workflowId, workflowId),
          inArray(workflowEvalSuite.name, [...FIXTURE_SUITE_NAMES])
        )
      )

    const existingSuiteNames = new Set(existingSuites.map(({ name }) => name))
    if (existingSuiteNames.size !== existingSuites.length) {
      throw new Error(
        `Workflow ${workflowId} contains duplicate eval fixture suite names: ${existingSuites.map(({ name }) => name).join(', ')}`
      )
    }

    const existingWorkflowJudgeSuite = existingSuites.find(
      ({ name }) => name === WORKFLOW_SUITE_NAME
    )
    if (existingWorkflowJudgeSuite) {
      assertWorkflowJudgeSuite(existingWorkflowJudgeSuite.tests, judgeFixture)
    }

    const fixtureSuites = [
      { name: SUPPORT_SUITE_NAME, tests: supportTests },
      { name: READY_SUITE_NAME, tests: readyTests },
      { name: MULTI_ROW_SUITE_NAME, tests: multiRowTests },
      { name: AGENT_SUITE_NAME, tests: agentTests },
      { name: WORKFLOW_SUITE_NAME, tests: workflowJudgeTests },
    ] as const
    const missingSuites = fixtureSuites.filter(({ name }) => !existingSuiteNames.has(name))
    if (missingSuites.length > 0) {
      await tx.insert(workflowEvalSuite).values(
        missingSuites.map(({ name, tests }) => ({
          id: generateId(),
          workflowId,
          name,
          tests,
          createdByUserId: workflowRow.userId,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }

    return {
      judgeWorkflowId: judgeFixture.workflowId,
      insertedSuiteNames: missingSuites.map(({ name }) => name),
    }
  })

  logger.info('Seeded runnable workflow eval fixtures', { workflowId, ...seedResult })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Failed to seed workflow eval fixtures', {
      error: toError(error),
    })
    process.exit(1)
  })
