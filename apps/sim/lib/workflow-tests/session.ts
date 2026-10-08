import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type JudgeVerdict, judgeRubric } from '@/lib/workflow-tests/judge'
import {
  createMockChannel,
  type MockChannel,
  type MockMatcher,
  type ParkedMockCall,
} from '@/lib/workflow-tests/mock-channel'
import type { TestCaseStatus, TestEvent, TestTarget } from '@/lib/workflow-tests/protocol'
import {
  runWorkflowForTest,
  type WorkflowTestRunResult,
  type WorkflowTestVersion,
} from '@/lib/workflows/application/run-workflow-for-test'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { getActiveWorkflowName, listActiveWorkflowsNamed } from '@/lib/workflows/queries'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import { resolveTriggerRunOptions } from '@/lib/workflows/triggers/run-options'
import { normalizeName } from '@/executor/constants'
import type { TestWorkflowBlock } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'
import { hasExecutionResult, readAttemptedExecutionId } from '@/executor/utils/errors'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'
import { hasToolId } from '@/tools/tool-ids'

/** How long one `testNext` broker call waits before answering `waiting`, well under the broker timeout. */
const EVENT_WAIT_MS = 25_000

export interface WorkflowTestSessionConfig {
  workspaceId: string
  principal: Principal
  version: WorkflowTestVersion
  /** Full test names (`describe > it`) to run; null runs every test. */
  only: string[] | null
  /** Records a case starting or finishing while the file runs. */
  onProgress: (path: string[], status: TestCaseStatus) => Promise<void>
}

interface RunOutcome {
  executionId: string
  output: unknown
  error?: string
  logs: NonNullable<ExecutionResult['logs']>
}

function cancellableDelay(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

async function resolveWorkflowId(workspaceId: string, name: string): Promise<string> {
  const matches = await listActiveWorkflowsNamed(workspaceId, name)
  if (matches.length === 0) throw new OrchestrationError('not_found', `No workflow named "${name}"`)
  if (matches.length > 1) {
    throw new OrchestrationError(
      'validation',
      `More than one workflow is named "${name}"; rename one`
    )
  }
  return matches[0].id
}

async function loadWorkflowBlocks(
  workflowId: string,
  workspaceId: string,
  version: WorkflowTestVersion
): Promise<Record<string, BlockState>> {
  const state =
    version === 'draft'
      ? await loadWorkflowFromNormalizedTables(workflowId)
      : await loadDeployedWorkflowState(workflowId, workspaceId)
  if (!state?.blocks) {
    throw new OrchestrationError('validation', `The workflow has no ${version} version to test`)
  }
  return state.blocks
}

/**
 * The trigger block a run starts from: the one the test names, or the workflow's only one.
 * A workflow with several triggers must be told which, by name.
 */
function chooseTrigger(
  workflow: string,
  blocks: Record<string, BlockState>,
  trigger: string | null
): string | undefined {
  const options = resolveTriggerRunOptions(blocks)
  if (trigger !== null) {
    const chosen = options.find(
      (option) => normalizeName(option.blockName) === normalizeName(trigger)
    )
    if (!chosen) {
      throw new OrchestrationError(
        'validation',
        `${workflow} has no trigger named "${trigger}". Its triggers: ${options.map((option) => option.blockName).join(', ')}`
      )
    }
    return chosen.triggerBlockId
  }
  if (options.length > 1) {
    throw new OrchestrationError(
      'validation',
      `${workflow} has ${options.length} triggers; choose one with runWorkflow(name, input, { trigger: '…' }): ${options.map((option) => option.blockName).join(', ')}`
    )
  }
  return undefined
}

/** Tools test files may name: catalog tools, and MCP and custom tools by their prefixed ids. */
function assertKnownTool(toolId: string): void {
  if (hasToolId(toolId) || toolId.startsWith('mcp-') || toolId.startsWith('custom_')) return
  throw new OrchestrationError('validation', `mockTool("${toolId}"): there is no tool with that id`)
}

/** Placeholder output shaped like a block's real one, for its configured operation. */
function sampleBlockOutput(block: TestWorkflowBlock | undefined): Record<string, unknown> {
  if (!block) return {}
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(block.params)) subBlocks[key] = { value }
  return generateMockPayloadFromOutputsDefinition(getEffectiveBlockOutputs(block.type, subBlocks))
}

function sampleToolOutput(toolId: string): Record<string, unknown> {
  const outputs = getToolOutputsMetadata(toolId)
  return outputs ? generateMockPayloadFromOutputsDefinition(outputs) : {}
}

interface ToolMock {
  /** The Agent block it answers for; null answers every Agent. */
  blockId: string | null
  toolId: string
  key: string
}

/** The child a workflow block calls, when it names one by a fixed id rather than a reference. */
function childWorkflowId(id: unknown): string | undefined {
  return typeof id === 'string' && id.trim() !== '' && !id.includes('<') ? id : undefined
}

/** The mock answering this Agent's call to a tool: one named for that Agent wins over a general one. */
function toolMockFor(mocks: ToolMock[], blockId: string, toolId: string): ToolMock | undefined {
  return (
    mocks.find((mock) => mock.toolId === toolId && mock.blockId === blockId) ??
    mocks.find((mock) => mock.toolId === toolId && mock.blockId === null)
  )
}

/**
 * Matches one `runWorkflow()` call's mocks and spies to blocks by name, as each workflow it
 * executes (the tested one and every child) announces its blocks. A target naming a workflow
 * only reaches that workflow's blocks; an unnamed one reaches every workflow in the run.
 */
class RunMatcher implements MockMatcher {
  private readonly blocks = new Map<string, TestWorkflowBlock>()
  private readonly mockKeyByBlockId = new Map<string, string>()
  private readonly spyKeyByBlockId = new Map<string, string>()
  private readonly toolMocks: ToolMock[] = []
  private readonly workflowNames = new Map<string, string>()
  /** Keys whose target named a block in some workflow this run executed. */
  readonly matchedKeys = new Set<string>()
  readonly spyCalls: Array<{ key: string; input: unknown; output: unknown }> = []
  private readonly targets: TestTarget[]

  /** Workflows whose block names are known: every one that ran, and the children they call. */
  private readonly knownWorkflows = new Set<string>()

  constructor(
    targets: TestTarget[],
    private readonly loadChildBlocks: (workflowId: string) => Promise<Record<string, BlockState>>
  ) {
    for (const target of targets) if (target.kind === 'tool') assertKnownTool(target.tool)
    this.targets = [...targets].sort(
      (a, b) => Number(a.workflow === null) - Number(b.workflow === null)
    )
  }

  async enterWorkflow({
    workflowId,
    blocks,
  }: {
    workflowId: string
    blocks: TestWorkflowBlock[]
  }): Promise<void> {
    const workflowName = await this.workflowName(workflowId)
    for (const block of blocks) this.blocks.set(block.id, block)
    await this.learnWorkflow(
      workflowId,
      blocks.map((block) => ({
        name: block.name,
        childWorkflowId: childWorkflowId(block.params.workflowId),
      }))
    )
    for (const target of this.targets) {
      if (target.workflow !== null && normalizeName(target.workflow) !== workflowName) continue
      if (target.kind === 'tool' && target.block === null) {
        if (!this.toolMocks.some((mock) => mock.key === target.key)) {
          this.toolMocks.push({ blockId: null, toolId: target.tool, key: target.key })
        }
        this.matchedKeys.add(target.key)
        continue
      }
      const targetName = normalizeName(target.block ?? '')
      for (const block of blocks) {
        if (normalizeName(block.name) !== targetName) continue
        this.matchedKeys.add(target.key)
        if (target.kind === 'tool') {
          if (
            !this.toolMocks.some((mock) => mock.key === target.key && mock.blockId === block.id)
          ) {
            this.toolMocks.push({ blockId: block.id, toolId: target.tool, key: target.key })
          }
        } else if (target.kind === 'mock') {
          if (!this.mockKeyByBlockId.has(block.id)) this.mockKeyByBlockId.set(block.id, target.key)
          this.spyKeyByBlockId.delete(block.id)
        } else if (!this.mockKeyByBlockId.has(block.id) && !this.spyKeyByBlockId.has(block.id)) {
          this.spyKeyByBlockId.set(block.id, target.key)
        }
      }
    }
  }

  /**
   * Marks the targets naming a block of this workflow as real, then does the same for each
   * child it calls by a fixed id. A mock of a child the run never reached is set up, not a typo.
   */
  private async learnWorkflow(
    workflowId: string,
    blocks: Array<{ name: string; childWorkflowId: string | undefined }>
  ): Promise<void> {
    if (this.knownWorkflows.has(workflowId)) return
    this.knownWorkflows.add(workflowId)
    const workflowName = await this.workflowName(workflowId)
    const names = new Set(blocks.map((block) => normalizeName(block.name)))
    for (const target of this.targets) {
      if (target.workflow !== null && normalizeName(target.workflow) !== workflowName) continue
      if (target.block === null || names.has(normalizeName(target.block))) {
        this.matchedKeys.add(target.key)
      }
    }
    for (const block of blocks) {
      if (!block.childWorkflowId || this.knownWorkflows.has(block.childWorkflowId)) continue
      const childBlocks = await this.loadChildBlocks(block.childWorkflowId)
      await this.learnWorkflow(
        block.childWorkflowId,
        Object.values(childBlocks).map((child) => ({
          name: child.name,
          childWorkflowId: childWorkflowId(child.subBlocks?.workflowId?.value),
        }))
      )
    }
  }

  private async workflowName(workflowId: string): Promise<string> {
    const known = this.workflowNames.get(workflowId)
    if (known !== undefined) return known
    const name = normalizeName((await getActiveWorkflowName(workflowId)) ?? workflowId)
    this.workflowNames.set(workflowId, name)
    return name
  }

  mocksBlock(blockId: string): boolean {
    return this.mockKeyByBlockId.has(blockId)
  }

  mocksTool(blockId: string, toolId: string): boolean {
    return toolMockFor(this.toolMocks, blockId, toolId) !== undefined
  }

  spiesBlock(blockId: string): boolean {
    return this.spyKeyByBlockId.has(blockId)
  }

  recordSpy(call: { blockId: string; input: unknown; output: unknown }): void {
    const key = this.spyKeyByBlockId.get(call.blockId)
    if (key) this.spyCalls.push({ key, input: call.input, output: call.output })
  }

  mockKey(blockId: string): string | undefined {
    return this.mockKeyByBlockId.get(blockId)
  }

  toolMockKey(blockId: string, toolId: string): string | undefined {
    return toolMockFor(this.toolMocks, blockId, toolId)?.key
  }

  block(blockId: string): TestWorkflowBlock | undefined {
    return this.blocks.get(blockId)
  }
}

/** One `runWorkflow()` call: an executor run whose mocked blocks park on `channel`. */
class TestWorkflowRun {
  readonly id = generateId()
  private pendingCall: Promise<ParkedMockCall> | undefined
  private readonly outcome: Promise<RunOutcome>

  constructor(
    private readonly channel: MockChannel,
    execution: Promise<WorkflowTestRunResult>,
    private readonly abort: AbortController,
    private readonly matcher: RunMatcher
  ) {
    this.outcome = execution.then(
      ({ executionId, result }) => this.toOutcome(executionId, result),
      (error: unknown) => {
        const executionId = readAttemptedExecutionId(error) ?? ''
        if (hasExecutionResult(error)) return this.toOutcome(executionId, error.executionResult)
        return { executionId, output: null, error: getErrorMessage(error), logs: [] }
      }
    )
    void this.outcome.finally(() => this.channel.close(new Error('The workflow run finished')))
  }

  private toOutcome(executionId: string, result: ExecutionResult): RunOutcome {
    const error =
      result.status === 'paused'
        ? 'The workflow paused for human input. Mock the human-in-the-loop block to test past it.'
        : result.success
          ? undefined
          : (result.error ?? 'The workflow run failed')
    return {
      executionId,
      output: result.output,
      ...(error ? { error } : {}),
      logs: result.logs ?? [],
    }
  }

  async next(): Promise<TestEvent> {
    this.pendingCall ??= this.channel.nextCall()
    this.pendingCall.catch(() => {})
    const delay = cancellableDelay(EVENT_WAIT_MS)
    try {
      const winner = await Promise.race([
        this.pendingCall.then((call) => ({ type: 'call' as const, call })),
        this.outcome.then((outcome) => ({ type: 'done' as const, outcome })),
        delay.promise.then(() => ({ type: 'waiting' as const })),
      ])
      if (winner.type === 'waiting') return { kind: 'waiting', runId: this.id }
      if (winner.type === 'done') return this.doneEvent(winner.outcome)
      this.pendingCall = undefined
      return this.mockEvent(winner.call)
    } finally {
      delay.cancel()
    }
  }

  private mockEvent(parked: ParkedMockCall): TestEvent {
    if (parked.kind === 'tool') {
      const { blockId, toolId, input } = parked.call
      const key = this.matcher.toolMockKey(blockId, toolId)
      if (!key) throw new Error(`Tool ${toolId} was parked without a mock`)
      return {
        kind: 'mock',
        runId: this.id,
        callId: parked.callId,
        key,
        block: this.matcher.block(blockId)?.name ?? blockId,
        tool: toolId,
        input,
        sample: sampleToolOutput(toolId),
      }
    }
    const { blockId, blockName, input, branchIndex } = parked.call
    const key = this.matcher.mockKey(blockId)
    if (!key) throw new Error(`Block ${blockName} was parked without a mock`)
    return {
      kind: 'mock',
      runId: this.id,
      callId: parked.callId,
      key,
      block: blockName,
      input,
      sample: sampleBlockOutput(this.matcher.block(blockId)),
      ...(branchIndex !== undefined ? { branchIndex } : {}),
    }
  }

  private doneEvent(outcome: RunOutcome): TestEvent {
    return {
      kind: 'done',
      runId: this.id,
      executionId: outcome.executionId,
      output: outcome.output,
      ...(outcome.error ? { error: outcome.error } : {}),
      spyCalls: this.matcher.spyCalls,
      matchedKeys: [...this.matcher.matchedKeys],
    }
  }

  reply(callId: string, reply: { output: unknown } | { error: string }): void {
    if ('error' in reply) {
      this.channel.reply(callId, { error: reply.error })
      return
    }
    if (!isRecordLike(reply.output)) {
      this.channel.reply(callId, {
        error: 'A mocked block must return an object, like { ok: true }',
      })
      return
    }
    this.channel.reply(callId, { output: reply.output })
  }

  cancel(): void {
    this.abort.abort(new Error('The test finished'))
    this.channel.close(new Error('The test finished'))
  }
}

/**
 * Host state for one test file's sandbox run: the workflow runs its tests started, keyed by
 * run id. The brokers reach it through the sandbox request id.
 */
export class WorkflowTestSession {
  private readonly runs = new Map<string, TestWorkflowRun>()

  constructor(readonly config: WorkflowTestSessionConfig) {}

  async start(args: {
    workflow: string
    trigger: string | null
    input: unknown
    targets: TestTarget[]
  }): Promise<TestEvent> {
    const { workspaceId, principal, version } = this.config
    const workflowId = await resolveWorkflowId(workspaceId, args.workflow)
    const blocks = await loadWorkflowBlocks(workflowId, workspaceId, version)
    const triggerBlockId = chooseTrigger(args.workflow, blocks, args.trigger)
    const matcher = new RunMatcher(args.targets, (childId) =>
      loadWorkflowBlocks(childId, workspaceId, version)
    )
    const channel = createMockChannel(matcher)
    const abort = new AbortController()
    const execution = runWorkflowForTest({
      principal,
      workflowId,
      workspaceId,
      version,
      workflowInput: args.input,
      triggerBlockId,
      testHooks: channel.hooks,
      abortSignal: abort.signal,
    })
    const run = new TestWorkflowRun(channel, execution, abort, matcher)
    this.runs.set(run.id, run)
    return run.next()
  }

  progress(args: { path: string[]; status: TestCaseStatus }): Promise<void> {
    return this.config.onProgress(args.path, args.status)
  }

  next(runId: string): Promise<TestEvent> {
    return this.requireRun(runId).next()
  }

  reply(
    runId: string,
    callId: string,
    reply: { output: unknown } | { error: string }
  ): Promise<TestEvent> {
    const run = this.requireRun(runId)
    run.reply(callId, reply)
    return run.next()
  }

  cancel(runIds: string[]): void {
    for (const runId of runIds) {
      this.runs.get(runId)?.cancel()
      this.runs.delete(runId)
    }
  }

  close(): void {
    this.cancel([...this.runs.keys()])
  }

  judge(args: { value: string; rubric: string }): Promise<JudgeVerdict> {
    return judgeRubric({
      workspaceId: this.config.workspaceId,
      actorUserId: requirePrincipalSubjectUserId(this.config.principal),
      value: args.value,
      rubric: args.rubric,
    })
  }

  private requireRun(runId: string): TestWorkflowRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown workflow run "${runId}"`)
    return run
  }
}
