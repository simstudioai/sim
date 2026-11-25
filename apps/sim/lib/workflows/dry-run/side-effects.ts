import { createLogger } from '@sim/logger'
import { isReadRequest } from '@/lib/core/utils/http-methods'
import { sampleBlockOutput, sampleToolOutput } from '@/lib/workflows/dry-run/samples'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { BlockType, HUMAN_IN_THE_LOOP_BLOCK_TYPES } from '@/executor/constants'
import type {
  AnsweredBlockCall,
  CodeNetworkPolicy,
  DryRunOptions,
  SideEffectBlockSite,
  SideEffectPolicy,
  SideEffectSite,
  StubbedToolCall,
} from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'

const logger = createLogger('DryRunSideEffects')

/** Each list keeps at most this many entries; `omitted` counts the rest per list. */
const MAX_RECORDED = 50

/** The tool a stubbed or allowed network request of code is recorded under. */
const CODE_TOOL_ID = 'function_execute'

/** Blocks whose handlers change state outside the tool seam, so a policy answers them whole. */
const SELF_DIRECTED_BLOCK_TYPES: ReadonlySet<string> = new Set([BlockType.MOTHERSHIP, BlockType.PI])

/**
 * Blocks that pause the run. A test run is never resumed, so a policy answers them whole and the
 * run never pauses; they cannot be allowed.
 */
export const PAUSING_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...HUMAN_IN_THE_LOOP_BLOCK_TYPES,
  BlockType.WAIT,
])

/**
 * Blocks that run another workflow, whose writes a dry run always stubs, so allowing one would
 * send nothing: a Workflow block's child keeps its own block ids, and a custom block is answered
 * whole.
 */
export function runsAnotherWorkflow(blockType: string): boolean {
  return (
    blockType === BlockType.WORKFLOW ||
    blockType === BlockType.WORKFLOW_INPUT ||
    isCustomBlockType(blockType)
  )
}

interface RecordedSite {
  workflowId: string
  /** Null when the call named no block. */
  blockId: string | null
  block: string | null
}

/** A write the run did not send: the request it would have sent and the placeholder it got. */
interface StubbedSideEffect extends RecordedSite {
  /** The tool called; null when the whole block was answered instead of run. */
  tool: string | null
  request: Record<string, unknown> | null
  returned: Record<string, unknown>
}

/** A write sent for real because its block was allowed. */
interface AllowedSideEffect extends RecordedSite {
  tool: string | null
}

/** Code that ran for real in a remote sandbox, whose network the run cannot see. */
interface UncheckedSideEffect extends RecordedSite {
  reason: string
}

/** What a dry run did with each write it reached; each list holds at most {@link MAX_RECORDED}. */
export interface SideEffectsSummary {
  stubbed: StubbedSideEffect[]
  allowed: AllowedSideEffect[]
  unchecked: UncheckedSideEffect[]
  /** Entries each list left out once it was full. */
  omitted: { stubbed: number; allowed: number; unchecked: number }
}

function recordedSite(site: SideEffectSite): RecordedSite {
  return { workflowId: site.workflowId, blockId: site.blockId, block: site.blockName }
}

/** Why code ran where the run cannot see its network, named for the block that ran it. */
function uncheckedCodeReason(blockType: string | null): string {
  const unseen = 'ran for real in a remote sandbox, whose network calls a dry run cannot stub'
  switch (blockType) {
    case BlockType.FUNCTION:
      return `Function block code ${unseen}`
    case BlockType.AGENT:
      return `Code the Agent’s model wrote ${unseen}`
    case BlockType.CONDITION:
      return `Condition expressions ${unseen}`
    default:
      return `Code ${unseen}`
  }
}

/** A stubbed request's description, or null when building it fails: the request stays stubbed. */
async function describeOrNull(
  describe: () => Promise<Record<string, unknown> | null>
): Promise<Record<string, unknown> | null> {
  try {
    return await describe()
  } catch (error) {
    logger.warn('Could not describe a stubbed request of code; recording none', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return null
  }
}

/**
 * A bounded record of one kind of side effect: an entry keyed by `key` is kept once, and once
 * the list holds {@link MAX_RECORDED} the rest are counted.
 */
class RecordedList<T> {
  readonly entries: T[] = []
  omitted = 0
  private readonly keys = new Set<string>()

  /** Whether the next entry would only be counted. */
  get full(): boolean {
    return this.entries.length >= MAX_RECORDED
  }

  add(entry: T, key?: string): void {
    if (key !== undefined) {
      if (this.keys.has(key)) return
      this.keys.add(key)
    }
    if (this.entries.length < MAX_RECORDED) this.entries.push(entry)
    else this.omitted++
  }
}

/**
 * The side-effect policy of a dry run (`run.dry`) and of a workflow test's unmocked writes: every
 * write tool call is answered with a placeholder shaped like the tool's output, holding what the
 * request determines where the tool declares it (`dryRunOutput`), and recorded with
 * the request it would have sent, except an allowed block's, which are sent and recorded once per
 * block and tool. Reads always run. Code runs too: in the isolate its reads (`isReadRequest`) are
 * sent and any other request is answered with an empty 200 and recorded like a write, while code
 * in a remote sandbox, whose network the run cannot see, is listed unchecked. Custom blocks and
 * {@link PAUSING_BLOCK_TYPES} are answered whole, as is a block that acts outside the tool seam
 * unless it is allowed, and `blockMocks` answers its blocks with fixed outputs. Allowed and mocked
 * blocks are blocks of the workflow the run started, never of a child it calls, and an allowed
 * Agent's own tool calls are sent, not a workflow or custom block it calls.
 */
export class WriteStubPolicy implements SideEffectPolicy {
  private readonly stubbed = new RecordedList<StubbedSideEffect>()
  private readonly allowed = new RecordedList<AllowedSideEffect>()
  private readonly unchecked = new RecordedList<UncheckedSideEffect>()
  private readonly allowBlockIds: ReadonlySet<string>
  private readonly blockMocks: ReadonlyMap<string, NormalizedBlockOutput>

  constructor(
    private readonly options: {
      /** The workflow the run started. */
      workflowId: string
      /** Its blocks whose writes are sent. */
      allowBlockIds?: ReadonlySet<string>
      /** Its blocks answered with these outputs instead of running. */
      blockMocks?: ReadonlyMap<string, NormalizedBlockOutput>
    }
  ) {
    this.allowBlockIds = options.allowBlockIds ?? new Set()
    this.blockMocks = options.blockMocks ?? new Map()
  }

  /** The block's id when it is a block of the workflow the run started. */
  private runBlockId(site: SideEffectSite): string | null {
    return site.workflowId === this.options.workflowId ? site.blockId : null
  }

  private allows(site: SideEffectSite): boolean {
    const blockId = this.runBlockId(site)
    return blockId !== null && this.allowBlockIds.has(blockId)
  }

  private mockOf(site: SideEffectSite): NormalizedBlockOutput | undefined {
    const blockId = this.runBlockId(site)
    return blockId === null ? undefined : this.blockMocks.get(blockId)
  }

  /**
   * Three write tools are decided by what they run rather than by their block:
   * `deployed_block_executor` runs a custom block's publisher workflow, so it is answered whole,
   * like the block on a canvas; `workflow_executor` runs a child workflow, which inherits the
   * policy and decides its own writes, so it is sent; and `function_execute` runs the workflow's
   * own code (a Function block's, a Condition's expressions, or code an Agent's model wrote),
   * which is sent, its network decided by {@link codeNetwork}.
   */
  decideWrite(call: SideEffectSite & { toolId: string }): 'send' | 'stub' {
    switch (call.toolId) {
      case 'deployed_block_executor':
        return 'stub'
      case 'workflow_executor':
      case CODE_TOOL_ID:
        return 'send'
    }
    if (!this.allows(call)) return 'stub'
    this.allowed.add(
      { ...recordedSite(call), tool: call.toolId },
      `${call.workflowId}:${call.blockId}:${call.toolId}`
    )
    return 'send'
  }

  codeNetwork(site: SideEffectSite): CodeNetworkPolicy {
    const key = `${site.workflowId}:${site.blockId}`
    if (this.allows(site)) {
      const recordAllowed = () =>
        this.allowed.add({ ...recordedSite(site), tool: CODE_TOOL_ID }, `${key}:${CODE_TOOL_ID}`)
      return {
        ranInRemoteSandbox: recordAllowed,
        onRequest: async (request) => {
          if (!isReadRequest(request.method, request.headerNames)) recordAllowed()
          return 'send'
        },
      }
    }
    return {
      ranInRemoteSandbox: () =>
        this.unchecked.add(
          { ...recordedSite(site), reason: uncheckedCodeReason(site.blockType) },
          key
        ),
      onRequest: async (request) => {
        if (isReadRequest(request.method, request.headerNames)) return 'send'
        this.stubbed.add({
          ...recordedSite(site),
          tool: CODE_TOOL_ID,
          request: this.stubbed.full ? null : await describeOrNull(request.describe),
          returned: { status: 200, body: {} },
        })
        return 'stub'
      },
    }
  }

  stubWrite(call: StubbedToolCall): Record<string, unknown> {
    const returned = sampleToolOutput(call.toolId, call.echoed)
    this.stubbed.add({ ...recordedSite(call), tool: call.toolId, request: call.request, returned })
    return returned
  }

  answersBlock(block: SideEffectBlockSite): boolean {
    if (this.mockOf(block)) return true
    if (PAUSING_BLOCK_TYPES.has(block.blockType)) return true
    if (isCustomBlockType(block.blockType)) return true
    if (!SELF_DIRECTED_BLOCK_TYPES.has(block.blockType)) return false
    if (!this.allows(block)) return true
    this.allowed.add({ ...recordedSite(block), tool: null }, `${block.workflowId}:${block.blockId}`)
    return false
  }

  async answerBlock(call: AnsweredBlockCall): Promise<NormalizedBlockOutput> {
    const mock = this.mockOf(call)
    if (mock) return structuredClone(mock)
    const input = await call.input()
    const returned = sampleBlockOutput({ type: call.blockType, params: input ?? {} })
    this.stubbed.add({ ...recordedSite(call), tool: null, request: input, returned })
    return returned
  }

  /**
   * The allowed and mocked blocks, by id, which the run's log records so a rerun of this run passes
   * them again. Never the mock outputs, which a rerun passes again: the log shows a mocked block's
   * output only as that block's output, redacted like any other.
   */
  runOptions(): DryRunOptions {
    return { allowBlocks: [...this.allowBlockIds], mockedBlocks: [...this.blockMocks.keys()] }
  }

  summary(): SideEffectsSummary {
    return {
      stubbed: [...this.stubbed.entries],
      allowed: [...this.allowed.entries],
      unchecked: [...this.unchecked.entries],
      omitted: {
        stubbed: this.stubbed.omitted,
        allowed: this.allowed.omitted,
        unchecked: this.unchecked.omitted,
      },
    }
  }
}
