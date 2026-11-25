import { sampleBlockOutput, sampleToolOutput } from '@/lib/workflows/dry-run/samples'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { BlockType, HUMAN_IN_THE_LOOP_BLOCK_TYPES } from '@/executor/constants'
import type {
  AnsweredBlockCall,
  DryRunOptions,
  SideEffectBlockSite,
  SideEffectPolicy,
  SideEffectSite,
  StubbedToolCall,
} from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'

/** Each list keeps at most this many entries; `omitted` counts the rest per list. */
const MAX_RECORDED = 50

/**
 * The one write tool a policy always sends: `function_execute` runs code (a Function block's, a
 * Condition's expressions, or code an Agent's model wrote), which is the workflow's own logic
 * rather than a side effect. Code other than a Condition's is listed as unchecked, since it can
 * make network calls the run cannot see.
 */
const CODE_TOOL_ID = 'function_execute'

/**
 * The tool an Agent calls a custom block with. A custom block runs its publisher's workflow, so a
 * policy answers it whole, like the block on a canvas, and never runs it.
 */
const CUSTOM_BLOCK_TOOL_ID = 'deployed_block_executor'

/** Blocks whose handlers change state outside the tool seam, so a policy answers them whole. */
const SELF_DIRECTED_BLOCK_TYPES: ReadonlySet<string> = new Set([BlockType.MOTHERSHIP, BlockType.PI])

/**
 * Blocks that pause the run. A paused run resumes later without its dry run, so a dry run
 * answers them whole and never pauses; they cannot be allowed.
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

/** Code that ran for real whose effects the run cannot see. */
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

/** Why code the run cannot see ran for real, named for the block that ran it. */
function uncheckedCodeReason(blockType: string | null): string {
  if (blockType === BlockType.FUNCTION) {
    return 'Function block code ran for real; network calls it makes are not stubbed'
  }
  if (blockType === BlockType.AGENT) {
    return 'Code the Agent’s model wrote ran for real; network calls it makes are not stubbed'
  }
  return 'Code ran for real; network calls it makes are not stubbed'
}

/**
 * A bounded record of one kind of side effect: an entry keyed by `key` is kept once, and once
 * the list holds {@link MAX_RECORDED} the rest are counted.
 */
class RecordedList<T> {
  readonly entries: T[] = []
  omitted = 0
  private readonly keys = new Set<string>()

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
 * write tool call is answered with a placeholder shaped like the tool's output and recorded with
 * the request it would have sent, except an allowed block's, which are sent and recorded once per
 * block and tool. Reads always run. Custom blocks and blocks that act outside the tool seam are
 * answered whole; `pausingBlocks: 'stub'` also answers {@link PAUSING_BLOCK_TYPES} whole, and
 * `blockMocks` answers its blocks with fixed outputs. Allowed and mocked blocks are blocks of the
 * workflow the run started, never of a child it calls.
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
      pausingBlocks: 'run' | 'stub'
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

  decideWrite(call: SideEffectSite & { toolId: string }): 'send' | 'stub' {
    if (call.toolId === CUSTOM_BLOCK_TOOL_ID) return 'stub'
    if (call.toolId === CODE_TOOL_ID) {
      if (call.blockType !== BlockType.CONDITION) {
        this.unchecked.add(
          { ...recordedSite(call), reason: uncheckedCodeReason(call.blockType) },
          `${call.workflowId}:${call.blockId}`
        )
      }
      return 'send'
    }
    if (!this.allows(call)) return 'stub'
    this.allowed.add(
      { ...recordedSite(call), tool: call.toolId },
      `${call.workflowId}:${call.blockId}:${call.toolId}`
    )
    return 'send'
  }

  stubWrite(call: StubbedToolCall): Record<string, unknown> {
    const returned = sampleToolOutput(call.toolId)
    this.stubbed.add({ ...recordedSite(call), tool: call.toolId, request: call.request, returned })
    return returned
  }

  answersBlock(block: SideEffectBlockSite): boolean {
    if (this.mockOf(block)) return true
    if (this.options.pausingBlocks === 'stub' && PAUSING_BLOCK_TYPES.has(block.blockType)) {
      return true
    }
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

  /** The allowed and mocked blocks, which a rerun of this run passes again. */
  runOptions(): DryRunOptions {
    return { allowBlocks: [...this.allowBlockIds], mocks: Object.fromEntries(this.blockMocks) }
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
