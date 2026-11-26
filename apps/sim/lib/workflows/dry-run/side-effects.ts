import { createLogger } from '@sim/logger'
import { isReadRequest } from '@/lib/core/utils/http-methods'
import { PlaceholderTokens } from '@/lib/workflows/dry-run/placeholders'
import { sampleBlockOutput, sampleToolOutput } from '@/lib/workflows/dry-run/samples'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { BlockType, HUMAN_IN_THE_LOOP_BLOCK_TYPES } from '@/executor/constants'
import type {
  AnsweredBlockCall,
  CodeNetworkPolicy,
  McpCallTarget,
  RunOverrides,
  SideEffectBlockSite,
  SideEffectPolicy,
  SideEffectSite,
  StubbedToolCall,
  StubReason,
  ToolCallSite,
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

/** A call the run did not send: the request it would have sent and the placeholder it got. */
interface StubbedSideEffect extends RecordedSite {
  /** The tool called; null when the whole block was answered instead of run. */
  tool: string | null
  request: Record<string, unknown> | null
  returned: Record<string, unknown>
  /** The MCP server and tool the MCP block's operation names; unset for any other call. */
  mcp?: McpCallTarget
  /** Why a call that is not a plain write was held back; unset for a plain write. */
  reason?: StubReason
}

/** A write sent for real because its block was allowed. */
interface AllowedSideEffect extends RecordedSite {
  tool: string | null
  /** The MCP server and tool the MCP block's operation names; unset for any other call. */
  mcp?: McpCallTarget
}

/** Code that ran for real in a remote sandbox, whose network the run cannot see. */
interface UncheckedSideEffect extends RecordedSite {
  reason: string
}

/** A block a dry run's `run.allow` or `run.mocks` names: a block of the run's workflow or a child's. */
export interface DryRunOverride {
  workflowId: string
  blockId: string
  /** Its display name, which {@link SideEffectsSummary.unreached} reports. */
  block: string
}

/** A block a dry run answers with a fixed output instead of running it. */
export interface DryRunMock extends DryRunOverride {
  output: NormalizedBlockOutput
  /** The run the output was read from (`run.mocksFrom`); unset for an output the caller passed. */
  sourceRunId?: string
  /** Top-level fields of the output the block does not declare, which the summary reports. */
  undeclaredFields: string[]
  /** Fields of the recorded output only its handler may set, left out of a mock read from a run. */
  droppedFields: string[]
}

/** An allowed or mocked block the run never reached. */
interface UnreachedOverride extends DryRunOverride {
  kind: 'allow' | 'mock'
}

/** A mock's fields its block does not declare, and fields left out of a recorded output. */
interface MockFields extends DryRunOverride {
  undeclared?: string[]
  dropped?: string[]
}

/**
 * What a dry run did with each write it reached; each list holds at most {@link MAX_RECORDED}.
 * `stubbed`, `allowed` and `unchecked` are always present; the notes about overrides
 * (`unreached`, `mockFields`) only when they hold an entry.
 */
export interface SideEffectsSummary {
  stubbed: StubbedSideEffect[]
  allowed: AllowedSideEffect[]
  unchecked: UncheckedSideEffect[]
  /** Entries each list left out once it was full. */
  omitted: { stubbed: number; allowed: number; unchecked: number }
  unreached?: UnreachedOverride[]
  mockFields?: MockFields[]
}

/** The key an allowed or mocked block is matched by: its workflow and block id. */
export function overrideKey(site: { workflowId: string; blockId: string | null }): string {
  return `${site.workflowId}:${site.blockId}`
}

function recordedSite(site: SideEffectSite): RecordedSite {
  return { workflowId: site.workflowId, blockId: site.blockId, block: site.blockName }
}

/** The MCP target of a call as its entry records it: present only for an MCP call. */
function mcpOf(mcp: McpCallTarget | null): { mcp?: McpCallTarget } {
  return mcp ? { mcp } : {}
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
 * block and tool (an MCP block's by the MCP tool it names). Reads run, except one that would send
 * a placeholder an answer returned (a `dry_run_<kind>_<n>` token or a placeholder number), which
 * is answered with a placeholder too, and is listed with reason `placeholder`. Every MCP call is a write
 * here, even one its server declares read-only, since Sim cannot verify that claim. Code runs too:
 * in the isolate its reads (`isReadRequest`) are sent, unless they would send a placeholder, and any
 * other request is answered with an empty 200 and recorded like a write, while code in a remote
 * sandbox, whose network the run cannot see, is listed unchecked. Custom blocks and
 * {@link PAUSING_BLOCK_TYPES} are answered whole, as is a block that acts outside the tool seam
 * unless it is allowed, and `blockMocks` answers its blocks with fixed outputs. An allowed or
 * mocked block is keyed by its workflow and block id, so one of a child applies wherever that
 * child runs, at every depth, and an allowed Agent's own tool calls are sent, not a workflow or
 * custom block it calls.
 */
export class WriteStubPolicy implements SideEffectPolicy {
  private readonly stubbed = new RecordedList<StubbedSideEffect>()
  private readonly allowed = new RecordedList<AllowedSideEffect>()
  private readonly unchecked = new RecordedList<UncheckedSideEffect>()
  private readonly allowedBlocks: ReadonlyMap<string, DryRunOverride>
  private readonly blockMocks: ReadonlyMap<string, DryRunMock>
  /** Keys of the allowed and mocked blocks the run reached. */
  private readonly reached = new Set<string>()
  private readonly placeholders = new PlaceholderTokens()
  /** Keys of the blocks answered, or with a call answered, with a placeholder. */
  private readonly answeredSites = new Set<string>()

  constructor(
    private readonly options: {
      /** The workflow the run started. */
      workflowId: string
      /** Blocks whose writes are sent. */
      allow?: readonly DryRunOverride[]
      /** Blocks answered with these outputs instead of running. */
      mocks?: readonly DryRunMock[]
    }
  ) {
    this.allowedBlocks = new Map((options.allow ?? []).map((entry) => [overrideKey(entry), entry]))
    this.blockMocks = new Map((options.mocks ?? []).map((entry) => [overrideKey(entry), entry]))
  }

  private allows(site: SideEffectSite): boolean {
    return site.blockId !== null && this.allowedBlocks.has(overrideKey(site))
  }

  private mockOf(site: SideEffectSite): NormalizedBlockOutput | undefined {
    return site.blockId === null ? undefined : this.blockMocks.get(overrideKey(site))?.output
  }

  /**
   * Three write tools are decided by what they run rather than by their block:
   * `deployed_block_executor` runs a custom block's publisher workflow, so it is answered whole,
   * like the block on a canvas; `workflow_executor` runs a child workflow, which inherits the
   * policy and decides its own writes, so it is sent; and `function_execute` runs the workflow's
   * own code (a Function block's, a Condition's expressions, or code an Agent's model wrote),
   * which is sent, its network decided by {@link codeNetwork}.
   */
  decideWrite(call: ToolCallSite): 'send' | 'stub' {
    switch (call.toolId) {
      case 'deployed_block_executor':
        return 'stub'
      case 'workflow_executor':
      case CODE_TOOL_ID:
        return 'send'
    }
    if (!this.allows(call)) return 'stub'
    const mcpKey = call.mcp ? `:${call.mcp.server}:${call.mcp.tool}` : ''
    this.allowed.add(
      { ...recordedSite(call), tool: call.toolId, ...mcpOf(call.mcp) },
      `${call.workflowId}:${call.blockId}:${call.toolId}${mcpKey}`
    )
    return 'send'
  }

  /**
   * Code in a remote sandbox is listed unchecked even when its block is allowed: allowing it
   * changes nothing there, and `allowed` lists only writes known to be sent.
   */
  codeNetwork(site: SideEffectSite): CodeNetworkPolicy {
    const key = `${site.workflowId}:${site.blockId}`
    const allowed = this.allows(site)
    return {
      ranInRemoteSandbox: () =>
        this.unchecked.add(
          { ...recordedSite(site), reason: uncheckedCodeReason(site.blockType) },
          key
        ),
      onRequest: async (request) => {
        const reads = isReadRequest(request.method, request.headerNames)
        const readsPlaceholder =
          reads && this.placeholders.occursIn([request.url, request.headerValues, request.body])
        if (reads && !readsPlaceholder) return 'send'
        if (allowed && !readsPlaceholder) {
          this.allowed.add({ ...recordedSite(site), tool: CODE_TOOL_ID }, `${key}:${CODE_TOOL_ID}`)
          return 'send'
        }
        this.answeredSites.add(overrideKey(site))
        this.stubbed.add({
          ...recordedSite(site),
          tool: CODE_TOOL_ID,
          request: this.stubbed.full ? null : await describeOrNull(request.describe),
          returned: { status: 200, body: {} },
          ...(readsPlaceholder ? { reason: 'placeholder' as const } : {}),
        })
        return 'stub'
      },
    }
  }

  stubCall(call: StubbedToolCall): Record<string, unknown> {
    const returned = sampleToolOutput(call.toolId, call.echoed, call.discoveredOutputs)
    this.placeholders.register(returned, call.echoed)
    this.answeredSites.add(overrideKey(call))
    this.stubbed.add({
      ...recordedSite(call),
      tool: call.toolId,
      request: call.request,
      returned,
      ...mcpOf(call.mcp),
      ...(call.reason ? { reason: call.reason } : {}),
    })
    return returned
  }

  stubbedFull(): boolean {
    return this.stubbed.full
  }

  sendsPlaceholder(sent: unknown): boolean {
    return this.placeholders.occursIn(sent)
  }

  answersBlock(block: SideEffectBlockSite): boolean {
    const key = overrideKey(block)
    if (this.allowedBlocks.has(key) || this.blockMocks.has(key)) this.reached.add(key)
    if (this.mockOf(block)) return true
    if (PAUSING_BLOCK_TYPES.has(block.blockType)) return true
    if (isCustomBlockType(block.blockType)) return true
    if (!SELF_DIRECTED_BLOCK_TYPES.has(block.blockType)) return false
    if (!this.allows(block)) return true
    this.allowed.add({ ...recordedSite(block), tool: null }, `${block.workflowId}:${block.blockId}`)
    return false
  }

  answeredWithPlaceholder(block: SideEffectBlockSite): boolean {
    return this.answeredSites.has(overrideKey(block))
  }

  async answerBlock(call: AnsweredBlockCall): Promise<NormalizedBlockOutput> {
    const mock = this.mockOf(call)
    if (mock) return structuredClone(mock)
    const input = await call.input()
    const returned = sampleBlockOutput({ type: call.blockType, params: input ?? {} })
    this.placeholders.register(returned)
    this.answeredSites.add(overrideKey(call))
    this.stubbed.add({
      ...recordedSite(call),
      tool: null,
      request: input,
      returned,
    })
    return returned
  }

  /**
   * The run's overrides as selectors a rerun passes again, which the run's log records: a block of
   * the run's workflow by its id, a child's as `<workflowId>.<blockId>`, and the mocks read from
   * another run under that run's id. Never the mock outputs, which a rerun passes again: the log
   * shows a mocked block's output only as that block's output, redacted like any other.
   */
  overrides(): RunOverrides {
    const selector = ({ workflowId, blockId }: DryRunOverride) =>
      workflowId === this.options.workflowId ? blockId : `${workflowId}.${blockId}`
    const mocks = [...this.blockMocks.values()]
    const read = mocks.filter((mock) => mock.sourceRunId !== undefined)
    return {
      allow: [...this.allowedBlocks.values()].map(selector),
      mocks: mocks.filter((mock) => mock.sourceRunId === undefined).map(selector),
      ...(read[0]?.sourceRunId
        ? { mocksFrom: { runId: read[0].sourceRunId, blocks: read.map((mock) => mock.blockId) } }
        : {}),
    }
  }

  summary(): SideEffectsSummary {
    const site = ({ workflowId, blockId, block }: DryRunOverride) => ({
      workflowId,
      blockId,
      block,
    })
    const unreached = [
      ...[...this.allowedBlocks.values()].map((entry) => ({
        ...site(entry),
        kind: 'allow' as const,
      })),
      ...[...this.blockMocks.values()].map((entry) => ({ ...site(entry), kind: 'mock' as const })),
    ].filter((entry) => !this.reached.has(overrideKey(entry)))
    const mockFields = [...this.blockMocks.values()]
      .filter((mock) => mock.undeclaredFields.length > 0 || mock.droppedFields.length > 0)
      .map((mock) => ({
        ...site(mock),
        ...(mock.undeclaredFields.length > 0 ? { undeclared: mock.undeclaredFields } : {}),
        ...(mock.droppedFields.length > 0 ? { dropped: mock.droppedFields } : {}),
      }))
    return {
      stubbed: [...this.stubbed.entries],
      allowed: [...this.allowed.entries],
      unchecked: [...this.unchecked.entries],
      omitted: {
        stubbed: this.stubbed.omitted,
        allowed: this.allowed.omitted,
        unchecked: this.unchecked.omitted,
      },
      ...(unreached.length > 0 ? { unreached } : {}),
      ...(mockFields.length > 0 ? { mockFields } : {}),
    }
  }
}
