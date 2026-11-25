import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import {
  type BlockState,
  isWorkflowBlockProtected,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_CALL_CHAIN_DEPTH } from '@/lib/execution/call-chain'
import { listBlocks, resolveBlockSelector } from '@/lib/workflows/application/block-selector'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import {
  type DryRunMock,
  type DryRunOverride,
  overrideKey,
  PAUSING_BLOCK_TYPES,
  runsAnotherWorkflow,
  SELF_DIRECTED_BLOCK_TYPES,
  WriteStubPolicy,
} from '@/lib/workflows/dry-run'
import {
  isCustomBlockSourceWorkflow,
  listActiveWorkflowIdsByIdOrName,
  loadWorkflowReadSnapshots,
} from '@/lib/workflows/queries'
import { getWorkflowInvocationTarget } from '@/lib/workflows/streaming/nested-output-options'
import { getBlock } from '@/blocks/registry'
import { BlockType } from '@/executor/constants'
import { isRunControlledOutputField, mockOutputRefusal } from '@/executor/utils/mock-output'
import { TEST_TRIGGER } from '@/stores/logs/filters/types'
import { getToolMetadata } from '@/tools/metadata'

/** The blocks a manual run asks a dry run to send or answer. */
export interface DryRunRequest {
  /** Answer writes with placeholders and return what each would have sent (`run.dry`). */
  dry?: boolean
  /** Blocks, by selector, whose writes a dry run sends for real (`run.allowBlocks`). */
  allowBlocks?: string[]
  /** Block selector to the output that answers the block in a dry run (`run.mocks`). */
  mocks?: Record<string, Record<string, unknown>>
  /** Blocks answered with their outputs in another run of this workflow (`run.mocksFrom`). */
  mocksFrom?: { runId: string; blocks: string[] }
}

/** A workflow whose blocks a dry run's overrides may name, as its saved draft holds them. */
interface OverrideWorkflow {
  id: string
  name: string
  blocks: Record<string, BlockState>
}

interface OverrideTarget extends DryRunOverride {
  workflow: OverrideWorkflow
}

/** The workflows reachable through Workflow blocks, as far as the saved drafts say. */
interface CallGraph {
  /** Children called by a fixed id, at any depth, by id. */
  called: Map<string, OverrideWorkflow>
  /** Whether some Workflow block chooses its child as the run goes, by a reference. */
  choosesAtRunTime: boolean
}

/** Blocks whose outputs depend on what the model or code returns, so none is undeclared. */
const DYNAMIC_OUTPUT_BLOCK_TYPES: ReadonlySet<string> = new Set([
  BlockType.AGENT,
  BlockType.FUNCTION,
])

const CONTAINER_BLOCK_TYPES: ReadonlySet<string> = new Set([BlockType.LOOP, BlockType.PARALLEL])

/** Tools a dry run sends whatever the block, as `WriteStubPolicy.decideWrite` does. */
const ALWAYS_SENT_TOOLS: ReadonlySet<string> = new Set(['function_execute', 'workflow_executor'])

function overrideTarget(workflow: OverrideWorkflow, blockId: string): OverrideTarget {
  return {
    workflow,
    workflowId: workflow.id,
    blockId,
    block: workflow.blocks[blockId]?.name ?? blockId,
  }
}

async function loadWorkspaceWorkflows(
  workflowIds: string[],
  workspaceId: string
): Promise<OverrideWorkflow[]> {
  if (workflowIds.length === 0) return []
  const snapshots = await loadWorkflowReadSnapshots(workflowIds, workspaceId)
  const workflows: OverrideWorkflow[] = []
  for (const { normalizedData, workflowRecord } of snapshots.values()) {
    if (!normalizedData) continue
    workflows.push({
      id: workflowRecord.id,
      name: workflowRecord.name,
      blocks: normalizedData.blocks,
    })
  }
  return workflows
}

/** The blocks containing `blockId`, innermost first, then the block itself first of all. */
function blockAndAncestors(blocks: Record<string, BlockState>, blockId: string): BlockState[] {
  const chain: BlockState[] = []
  const seen = new Set<string>()
  for (let id: string | undefined = blockId; id && !seen.has(id); id = blocks[id]?.data?.parentId) {
    seen.add(id)
    const block = blocks[id]
    if (block) chain.push(block)
  }
  return chain
}

/**
 * Resolves a dry run's block selectors to blocks of the run's workflow, or, in the dotted form
 * `<workflow>.<block>` (a workflow id or name, then a block id, name or key), of a workflow it
 * calls. A selector without a dot names a block of the run's workflow by id, name or key. A dotted
 * one names a block of the run's workflow only by its exact id or display name, since keys drop
 * dots, and otherwise a child's: one its Workflow blocks call by a fixed id (at every depth a run
 * can reach), matched by id then by name or its key, else, for a child chosen as the run goes, a
 * workflow of this workspace by id or exact name. Every workspace lookup the request's selectors
 * need is one query, made once; a workflow of another workspace is never found, so a refusal says
 * nothing of whether it exists. A selector naming several blocks is refused with them.
 */
class OverrideResolver {
  private graph: Promise<CallGraph> | undefined
  private inWorkspace: Promise<OverrideWorkflow[]> | undefined

  constructor(
    private readonly root: OverrideWorkflow,
    private readonly workspaceId: string,
    /** Every selector of the request, so the workspace is asked about all of them at once. */
    private readonly selectors: readonly string[]
  ) {}

  async resolve(selector: string, field: string): Promise<OverrideTarget> {
    if (!selector.includes('.')) {
      return overrideTarget(this.root, resolveBlockSelector(this.root.blocks, selector, field))
    }
    const candidates = new Map<string, OverrideTarget>()
    const add = (target: OverrideTarget) => candidates.set(overrideKey(target), target)
    for (const [blockId, block] of Object.entries(this.root.blocks)) {
      if (blockId === selector || block.name === selector) add(overrideTarget(this.root, blockId))
    }
    const namedWorkflows: OverrideWorkflow[] = []
    for (const [workflowName, blockSelector] of dottedSplits(selector)) {
      for (const workflow of await this.named(workflowName)) {
        namedWorkflows.push(workflow)
        const blockKey = normalizeWorkflowBlockName(blockSelector)
        for (const [blockId, block] of Object.entries(workflow.blocks)) {
          if (blockId === blockSelector || normalizeWorkflowBlockName(block.name) === blockKey) {
            add(overrideTarget(workflow, blockId))
          }
        }
      }
    }
    const label = `${field} "${selector}"`
    const [only, ...others] = candidates.values()
    if (only && others.length === 0) {
      await this.refuseCustomBlockSource(only, label)
      return only
    }
    if (only) {
      throw new OrchestrationError(
        'validation',
        `${label} names ${candidates.size} blocks: ${[...candidates.values()]
          .map(
            (entry) =>
              `"${entry.workflow.name}"."${entry.block}" (${entry.workflowId}.${entry.blockId})`
          )
          .join(', ')}. Pass the workflow id and block id.`
      )
    }
    const [workflow] = namedWorkflows
    if (workflow) {
      throw new OrchestrationError(
        'validation',
        `${label} names no block of workflow "${workflow.name}" (${workflow.id}). Pass one of its blocks' id, name or key: ${listBlocks(workflow.blocks, Object.keys(workflow.blocks))}.`
      )
    }
    throw new OrchestrationError(
      'validation',
      `${label} is not a block of this workflow, nor <workflow>.<block> for a workflow of this workspace it can call. This workflow's blocks: ${listBlocks(this.root.blocks, Object.keys(this.root.blocks))}.`
    )
  }

  /** The workflows `name` names: a called child by id, else by name or key, else the workspace's. */
  private async named(name: string): Promise<OverrideWorkflow[]> {
    const { called } = await this.callGraph()
    const byId = called.get(name)
    if (byId) return [byId]
    const key = normalizeWorkflowBlockName(name)
    const byName = [...called.values()].filter(
      (child) => normalizeWorkflowBlockName(child.name) === key
    )
    if (byName.length > 0) return byName
    const inWorkspace = await this.workspaceWorkflows()
    const chosenById = inWorkspace.filter((workflow) => workflow.id === name)
    return chosenById.length > 0
      ? chosenById
      : inWorkspace.filter((workflow) => workflow.name === name)
  }

  private callGraph(): Promise<CallGraph> {
    this.graph ??= this.walk()
    return this.graph
  }

  private async walk(): Promise<CallGraph> {
    const called = new Map<string, OverrideWorkflow>()
    let choosesAtRunTime = false
    const seen = new Set([this.root.id])
    let frontier = [this.root]
    for (let depth = 0; depth < MAX_CALL_CHAIN_DEPTH && frontier.length > 0; depth++) {
      const targets = new Set<string>()
      for (const workflow of frontier) {
        for (const block of Object.values(workflow.blocks)) {
          if (block.enabled === false) continue
          const target = getWorkflowInvocationTarget(block)
          if (target?.includes('<')) choosesAtRunTime = true
          else if (target && !seen.has(target)) targets.add(target)
        }
      }
      for (const target of targets) seen.add(target)
      frontier = await loadWorkspaceWorkflows([...targets], this.workspaceId)
      for (const child of frontier) called.set(child.id, child)
    }
    return { called, choosesAtRunTime }
  }

  /** The workspace's workflows named by any selector's workflow part, by id or exact name. */
  private workspaceWorkflows(): Promise<OverrideWorkflow[]> {
    this.inWorkspace ??= (async () => {
      const names = [
        ...new Set(
          this.selectors.flatMap((selector) => dottedSplits(selector).map(([name]) => name))
        ),
      ]
      const ids = await listActiveWorkflowIdsByIdOrName(this.workspaceId, names)
      return loadWorkspaceWorkflows(ids, this.workspaceId)
    })()
    return this.inWorkspace
  }

  /**
   * A workflow that publishes a custom block, found only in the workspace, is one this run reaches
   * only as that custom block, which a dry run answers whole, unless a Workflow block chooses its
   * child as the run goes and so may call it.
   */
  private async refuseCustomBlockSource(target: OverrideTarget, label: string): Promise<void> {
    if (target.workflow === this.root) return
    const { called, choosesAtRunTime } = await this.callGraph()
    if (called.has(target.workflowId) || choosesAtRunTime) return
    if (!(await isCustomBlockSourceWorkflow(target.workflowId))) return
    throw new OrchestrationError(
      'validation',
      `${label} names a block of workflow "${target.workflow.name}", which this run reaches only as a custom block; a dry run answers a custom block whole, so its blocks never run.`
    )
  }
}

/** Each way to split a dotted selector into `<workflow>` and `<block>`, at one of its dots. */
function dottedSplits(selector: string): Array<[string, string]> {
  const splits: Array<[string, string]> = []
  for (let dot = selector.indexOf('.'); dot > 0; dot = selector.indexOf('.', dot + 1)) {
    if (dot < selector.length - 1) splits.push([selector.slice(0, dot), selector.slice(dot + 1)])
  }
  return splits
}

/** Refuses a block the run never executes as itself: a disabled one, or a loop or parallel. */
function refuseUnrunnable(target: OverrideTarget, label: string): void {
  const chain = blockAndAncestors(target.workflow.blocks, target.blockId)
  if (chain.some((block) => block.enabled === false)) {
    throw new OrchestrationError(
      'validation',
      `${label} is disabled (or inside a disabled loop or parallel), so the run never executes it.`
    )
  }
  if (CONTAINER_BLOCK_TYPES.has(target.workflow.blocks[target.blockId].type)) {
    throw new OrchestrationError(
      'validation',
      `${label} is a loop or parallel, which runs the blocks inside it; name one of those blocks instead.`
    )
  }
}

function refuseUnallowable(target: OverrideTarget, label: string): void {
  const blockType = target.workflow.blocks[target.blockId].type
  if (PAUSING_BLOCK_TYPES.has(blockType)) {
    throw new OrchestrationError(
      'validation',
      `${label} is a Human in the loop or Wait block, which a dry run always answers with a placeholder and never pauses on; mock its output with run.mocks to choose it.`
    )
  }
  if (runsAnotherWorkflow(blockType)) {
    throw new OrchestrationError(
      'validation',
      `${label} runs another workflow (a Workflow or custom block), whose writes a dry run never sends; allow a block of that workflow as <workflow>.<block>, or mock this block's output with run.mocks.`
    )
  }
}

/**
 * Top-level output fields the block does not declare, which likely misspell one it does; none for
 * a block whose outputs the model or code decides, or whose outputs are unknown.
 */
function undeclaredOutputFields(block: BlockState, output: Record<string, unknown>): string[] {
  if (DYNAMIC_OUTPUT_BLOCK_TYPES.has(block.type)) return []
  const declared = Object.keys(
    getEffectiveBlockOutputs(block.type, block.subBlocks, { includeHidden: true })
  )
  if (declared.length === 0) return []
  const known = new Set([
    ...declared,
    ...Object.keys(getBlock(block.type)?.errorOutputs ?? {}),
    'error',
  ])
  return Object.keys(output).filter((field) => !known.has(field))
}

/**
 * Whether a test run answered this block with a placeholder unless it allowed or mocked it: a
 * block answered whole, one that runs another workflow (whose writes were placeholders too), or
 * one whose tool, for the operation it is configured with, is not declared `read`. An Agent's and
 * a Function's own output is real, whatever their tool calls returned.
 */
function answeredWithPlaceholder(block: BlockState): boolean {
  if (
    PAUSING_BLOCK_TYPES.has(block.type) ||
    SELF_DIRECTED_BLOCK_TYPES.has(block.type) ||
    runsAnotherWorkflow(block.type)
  ) {
    return true
  }
  if (DYNAMIC_OUTPUT_BLOCK_TYPES.has(block.type)) return false
  const tools = getBlock(block.type)?.tools
  if (!tools?.access?.length) return false
  const params = Object.fromEntries(
    Object.entries(block.subBlocks).map(([key, subBlock]) => [key, subBlock.value])
  )
  let toolId: string | undefined
  try {
    toolId = tools.config?.tool ? tools.config.tool(params) : tools.access[0]
  } catch {
    return true
  }
  if (!toolId) return true
  return !ALWAYS_SENT_TOOLS.has(toolId) && getToolMetadata(toolId)?.effect !== 'read'
}

interface RecordedMock {
  label: string
  blockId: string
  output: Record<string, unknown>
  droppedFields: string[]
}

/**
 * The output each block answered with in `runId`, a run of this workflow, read through the run
 * resource, so it is redacted like the run's log and withheld where the caller's permission group
 * withholds execution data. Fields only a block's handler may set (its cost, tokens, model, tool
 * calls or child traces, and `_` fields) are left out and reported, as `run.mocks` refuses them.
 * Refused: a block the run did not execute; one inside a loop or parallel, whose recorded output
 * is one iteration's, unless the run mocked it (every iteration answered alike); and, when the
 * run was itself a test run, a block it answered with a placeholder rather than mocked or allowed.
 */
async function readRecordedOutputs(
  principal: WorkflowExecutionPrincipal,
  root: OverrideWorkflow,
  mocksFrom: { runId: string; blocks: string[] }
): Promise<RecordedMock[]> {
  const { runId } = mocksFrom
  const selected = mocksFrom.blocks.map((selector) => {
    const label = `run.mocksFrom.blocks "${selector}"`
    try {
      return { label, blockId: resolveBlockSelector(root.blocks, selector, 'run.mocksFrom.blocks') }
    } catch (error) {
      if (!selector.includes('.')) throw error
      throw new OrchestrationError(
        'validation',
        `${label} is not a block of this workflow. Only this workflow's blocks can be mocked from a run; pass a child's output with run.mocks as <workflow>.<block>.`
      )
    }
  })
  const run = await readWorkflowRun
    .execute({
      principal,
      input: {
        workflowId: root.id,
        runId,
        includeOutput: false,
        selectedOutputs: [...new Set(selected.map((entry) => entry.blockId))],
      },
    })
    .catch((error: unknown) => {
      if (error instanceof OrchestrationError && error.code === 'not_found') {
        throw new OrchestrationError(
          'not_found',
          `run.mocksFrom.runId "${runId}" is not a run of this workflow, or its log has expired.`
        )
      }
      throw error
    })
  if (run.status === 'queued' || run.status === 'pending' || run.status === 'running') {
    throw new OrchestrationError(
      'conflict',
      `run.mocksFrom.runId "${runId}" is still ${run.status}; mock from it once it settles.`
    )
  }
  const { blockOutputs } = run
  if (!blockOutputs) {
    if (run.outputsHidden) {
      throw new OrchestrationError(
        'forbidden',
        `run.mocksFrom.runId "${runId}": your permission group hides runs' execution data, so its block outputs cannot be read.`
      )
    }
    throw new OrchestrationError(
      'conflict',
      `run.mocksFrom.runId "${runId}" has no recorded block outputs yet; mock from a run whose log is written.`
    )
  }
  const sourceIsTestRun = run.trigger === TEST_TRIGGER
  const sourceMocked = new Set([
    ...(run.dryRun?.mockedBlocks ?? []),
    ...(run.dryRun?.mocksFrom?.blockIds ?? []),
  ])
  const sourceAllowed = new Set(run.dryRun?.allowBlocks ?? [])
  return selected.map(({ label, blockId }) => {
    const mockedThere = sourceMocked.has(blockId)
    if (!mockedThere && blockAndAncestors(root.blocks, blockId).length > 1) {
      throw new OrchestrationError(
        'validation',
        `${label} is inside a loop or parallel, whose recorded output is one iteration's; pass its output with run.mocks instead.`
      )
    }
    const output = blockOutputs[blockId]
    if (output === undefined) {
      throw new OrchestrationError(
        'validation',
        mockedThere
          ? `${label} was mocked in run "${runId}" but never ran there, so the run recorded no output; pass it again with --mock <block>=<json> (run.mocks).`
          : `${label} did not run in run "${runId}", so it recorded no output.`
      )
    }
    if (!isRecordLike(output)) {
      throw new OrchestrationError(
        'validation',
        `${label} recorded an output that is not an object in run "${runId}".`
      )
    }
    if (
      sourceIsTestRun &&
      !mockedThere &&
      !sourceAllowed.has(blockId) &&
      answeredWithPlaceholder(root.blocks[blockId])
    ) {
      throw new OrchestrationError(
        'validation',
        `${label}: run "${runId}" is a test run, which answered this block with a placeholder instead of running it; mock from a run that ran it, or pass its output with run.mocks.`
      )
    }
    const kept = Object.entries(output).filter(([field]) => !isRunControlledOutputField(field))
    return {
      label,
      blockId,
      output: Object.fromEntries(kept),
      droppedFields: Object.keys(output).filter(isRunControlledOutputField),
    }
  })
}

/**
 * The dry run a manual run asked for: its allowed and mocked blocks, each a block of the run's
 * workflow or, as `<workflow>.<block>`, of a workflow it calls ({@link OverrideResolver}), so it
 * applies wherever that workflow runs. A dry run is logged under the `test` trigger, never as a
 * manual run, and returns its side effects with the result it waits for, so it cannot stream or
 * detach. Mocks need a dry run, so a fixed output reaches a real write only through a block the
 * caller allows. A mock is data ({@link mockOutputRefusal}), and never replaces a locked block
 * (refused as invalid), or a block of a locked workflow or folder (refused as locked, like any
 * change to one), whose configured behaviour only an admin may change. A block that never runs
 * as itself (a disabled one, a loop or a parallel) is refused, and a mock setting a field its
 * block does not declare is reported, not refused.
 */
export async function resolveRunOverrides(params: {
  principal: WorkflowExecutionPrincipal
  workspaceId: string
  workflow: { id: string; name: string }
  blocks: Record<string, BlockState>
  mode: 'sync' | 'stream' | 'sync-result-stream'
  detachable: boolean | undefined
  request: DryRunRequest
}) {
  const { request } = params
  if (!request.dry) {
    if (request.allowBlocks?.length) {
      throw new OrchestrationError('validation', 'run.allowBlocks requires run.dry')
    }
    if ((request.mocks && Object.keys(request.mocks).length > 0) || request.mocksFrom) {
      throw new OrchestrationError(
        'validation',
        `${request.mocksFrom ? 'run.mocksFrom' : 'run.mocks'} requires run.dry: a mocked block must never steer a run that sends its writes`
      )
    }
    return { triggerType: 'manual' as const }
  }
  if (params.mode === 'stream' || params.detachable) {
    throw new OrchestrationError(
      'validation',
      'run.dry returns its side effects with the run result, so it cannot be combined with stream or waitTimeoutSeconds'
    )
  }
  const root: OverrideWorkflow = { ...params.workflow, blocks: params.blocks }
  const passedMocks = Object.entries(request.mocks ?? {})
  const resolver = new OverrideResolver(root, params.workspaceId, [
    ...(request.allowBlocks ?? []),
    ...passedMocks.map(([selector]) => selector),
  ])

  const allowBlocks: DryRunOverride[] = []
  for (const selector of request.allowBlocks ?? []) {
    const label = `run.allowBlocks "${selector}"`
    const target = await resolver.resolve(selector, 'run.allowBlocks')
    refuseUnrunnable(target, label)
    refuseUnallowable(target, label)
    allowBlocks.push({
      workflowId: target.workflowId,
      blockId: target.blockId,
      block: target.block,
    })
  }

  const mocks: Array<{
    label: string
    target: OverrideTarget
    output: Record<string, unknown>
    recorded?: { runId: string; droppedFields: string[] }
  }> = []
  for (const [selector, output] of passedMocks) {
    const target = await resolver.resolve(selector, 'run.mocks')
    mocks.push({ label: `run.mocks "${selector}"`, target, output })
  }
  if (request.mocksFrom) {
    const { runId } = request.mocksFrom
    for (const entry of await readRecordedOutputs(params.principal, root, request.mocksFrom)) {
      mocks.push({
        label: entry.label,
        target: overrideTarget(root, entry.blockId),
        output: entry.output,
        recorded: { runId, droppedFields: entry.droppedFields },
      })
    }
  }

  const lockChecks = new Map<string, Promise<void>>()
  const labelsByKey = new Map<string, string>()
  const blockMocks: DryRunMock[] = []
  for (const { label, target, output, recorded } of mocks) {
    const key = overrideKey(target)
    const earlier = labelsByKey.get(key)
    if (earlier) {
      throw new OrchestrationError(
        'validation',
        `${earlier} and ${label} both name block "${target.block}" (${target.blockId}); mock it once.`
      )
    }
    labelsByKey.set(key, label)
    refuseUnrunnable(target, label)
    if (isWorkflowBlockProtected(target.blockId, target.workflow.blocks)) {
      throw new OrchestrationError(
        'validation',
        `${label} is a locked block (or inside a locked loop or parallel); its configured behaviour cannot be replaced.`
      )
    }
    let lockCheck = lockChecks.get(target.workflowId)
    if (!lockCheck) {
      lockCheck = requireMutableWorkflow(target.workflowId)
      lockChecks.set(target.workflowId, lockCheck)
    }
    await lockCheck.catch((error: unknown) => {
      if (error instanceof OrchestrationError && error.code === 'locked') {
        throw new OrchestrationError(
          'locked',
          `${label} is a block of workflow "${target.workflow.name}" (${error.message}); its configured behaviour cannot be replaced.`
        )
      }
      throw error
    })
    const refusal = mockOutputRefusal(label, output)
    if (refusal) throw new OrchestrationError('validation', refusal)
    blockMocks.push({
      workflowId: target.workflowId,
      blockId: target.blockId,
      block: target.block,
      output,
      ...(recorded ? { sourceRunId: recorded.runId } : {}),
      undeclaredFields: recorded
        ? []
        : undeclaredOutputFields(target.workflow.blocks[target.blockId], output),
      droppedFields: recorded?.droppedFields ?? [],
    })
  }

  return {
    triggerType: TEST_TRIGGER,
    sideEffectPolicy: new WriteStubPolicy({ workflowId: root.id, allowBlocks, blockMocks }),
  }
}
