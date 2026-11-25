import { sampleBlockOutput, sampleToolOutput } from '@/lib/workflows/dry-run/samples'
import { BlockType, HUMAN_IN_THE_LOOP_BLOCK_TYPES } from '@/executor/constants'
import type {
  SideEffectPolicy,
  SideEffectSite,
  StubbedBlockCall,
  StubbedToolCall,
} from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'

/** Each list keeps at most this many entries; `omitted` counts the rest. */
const MAX_RECORDED = 50

/**
 * The one tool a dry run sends although it is a `write`: `function_execute` runs a Function
 * block's code, which is the workflow's own logic rather than a side effect, so it runs and the
 * block is listed as unchecked (its code can make network calls the run cannot see).
 */
const WORKFLOW_CODE_TOOL_ID = 'function_execute'

/** Blocks whose handlers change state outside the tool seam, so a dry run answers them whole. */
const SELF_DIRECTED_BLOCK_TYPES: ReadonlySet<string> = new Set([BlockType.MOTHERSHIP, BlockType.PI])

/**
 * Blocks that pause the run. A paused run resumes later without its dry run, so a dry run
 * answers them whole and never pauses; they cannot be allowed.
 */
export const PAUSING_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...HUMAN_IN_THE_LOOP_BLOCK_TYPES,
  BlockType.WAIT,
])

interface RecordedSite {
  workflowId: string
  blockId: string
  block: string
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

/** A block that ran for real whose effects the run cannot see. */
interface UncheckedSideEffect extends RecordedSite {
  reason: string
}

/** What a dry run did with each write it reached; each list holds at most {@link MAX_RECORDED}. */
export interface SideEffectsSummary {
  stubbed: StubbedSideEffect[]
  allowed: AllowedSideEffect[]
  unchecked: UncheckedSideEffect[]
  /** Entries left out of the lists above once they were full. */
  omitted: number
}

function recordedSite(site: SideEffectSite): RecordedSite {
  return { workflowId: site.workflowId, blockId: site.blockId, block: site.blockName }
}

/**
 * The side-effect policy of a dry run (`run.dry`) and of a workflow test's unmocked writes: every
 * write tool call is answered with a placeholder shaped like the tool's output and recorded with
 * the request it would have sent, except an allowed block's, which are sent and recorded. Reads
 * always run. `pausingBlocks: 'stub'` also answers {@link PAUSING_BLOCK_TYPES} whole.
 */
export class DryRunSideEffects implements SideEffectPolicy {
  private readonly stubbed: StubbedSideEffect[] = []
  private readonly allowed: AllowedSideEffect[] = []
  private readonly unchecked = new Map<string, UncheckedSideEffect>()
  private omitted = 0

  constructor(
    private readonly options: {
      /** Top-level workflow blocks whose writes are sent. */
      allowBlockIds: ReadonlySet<string>
      pausingBlocks: 'run' | 'stub'
    }
  ) {}

  private record<T>(list: T[], entry: T): void {
    if (list.length < MAX_RECORDED) list.push(entry)
    else this.omitted++
  }

  sendsWrite(call: SideEffectSite & { toolId: string }): boolean {
    if (call.toolId === WORKFLOW_CODE_TOOL_ID) {
      const key = `${call.workflowId}:${call.blockId}`
      if (this.unchecked.has(key)) return true
      if (this.unchecked.size < MAX_RECORDED) {
        this.unchecked.set(key, {
          ...recordedSite(call),
          reason: 'Its code ran for real; network calls it makes are not stubbed',
        })
      } else this.omitted++
      return true
    }
    if (!this.options.allowBlockIds.has(call.blockId)) return false
    this.record(this.allowed, { ...recordedSite(call), tool: call.toolId })
    return true
  }

  stubWrite(call: StubbedToolCall): Record<string, unknown> {
    const returned = sampleToolOutput(call.toolId)
    this.record(this.stubbed, {
      ...recordedSite(call),
      tool: call.toolId,
      request: call.request,
      returned,
    })
    return returned
  }

  stubsBlock(block: SideEffectSite): boolean {
    if (this.options.pausingBlocks === 'stub' && PAUSING_BLOCK_TYPES.has(block.blockType)) {
      return true
    }
    if (!SELF_DIRECTED_BLOCK_TYPES.has(block.blockType)) return false
    if (!this.options.allowBlockIds.has(block.blockId)) return true
    this.record(this.allowed, { ...recordedSite(block), tool: null })
    return false
  }

  stubBlock(call: StubbedBlockCall): NormalizedBlockOutput {
    const returned = sampleBlockOutput({ type: call.blockType, params: call.input })
    this.record(this.stubbed, { ...recordedSite(call), tool: null, request: call.input, returned })
    return returned
  }

  summary(): SideEffectsSummary {
    return {
      stubbed: [...this.stubbed],
      allowed: [...this.allowed],
      unchecked: [...this.unchecked.values()],
      omitted: this.omitted,
    }
  }
}
