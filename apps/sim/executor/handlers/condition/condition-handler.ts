import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { normalizeStringRecord, normalizeWorkflowVariables } from '@/lib/core/utils/records'
import {
  isNonRetryableExecutionError,
  NonRetryableExecutionError,
} from '@/lib/execution/non-retryable-error'
import { isElseConditionTitle } from '@/lib/workflows/conditions'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, DEFAULTS, EDGE } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'
import {
  buildBranchNodeId,
  extractBaseBlockId,
  extractBranchIndex,
  isBranchNodeId,
} from '@/executor/utils/subflow-utils'
import { CONDITION_READS_ENVIRONMENT_KEY } from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('ConditionBlockHandler')

const CONDITION_TIMEOUT_MS = 5000

interface ConditionEntry {
  id: string
  title: string
  value: string
  /** Set by the resolver from the author's pre-resolution expression. */
  [CONDITION_READS_ENVIRONMENT_KEY]?: boolean
}

/** Verdict for a whole condition list evaluated in one function execution. */
type ConditionEvaluation =
  | { status: 'matched'; index: number }
  | { status: 'no-match' }
  | { status: 'expression-threw'; index: number; message: string }
  | { status: 'no-verdict'; message: string; retryable: boolean; timedOut: boolean }

/**
 * Wraps one expression as a boolean test, on its own line so a trailing line
 * comment ends before the closing parenthesis instead of swallowing it.
 *
 * The batched script and the per-branch fallback both wrap through here. Wrapping
 * them separately let the two drift: an expression carrying a trailing comment
 * parsed in the batch and failed in the fallback, so the recovery path rejected
 * a branch the primary path accepted.
 */
function buildBooleanTest(expression: string): string {
  return `Boolean(\n${expression}\n)`
}

/**
 * Builds one script that tests each expression in order and reports the index of
 * the first truthy one.
 *
 * Ordering and short-circuiting match evaluating the expressions one call at a
 * time: an expression is only reached once every earlier one returned falsy, so
 * a later expression that throws is still never reached and the run takes the
 * same branch it takes today. The `catch` reports the index it was on as data
 * rather than rethrowing, which is what lets the caller name the failing branch.
 */
function buildConditionScript(expressions: string[], evalContext: Record<string, unknown>): string {
  const tests = expressions
    .map(
      (expression, index) =>
        `  __simConditionIndex = ${index}\n` +
        `  if (${buildBooleanTest(expression)}) return { matchedIndex: ${index} }`
    )
    .join('\n')

  return [
    `const context = ${JSON.stringify(evalContext)};`,
    'let __simConditionIndex = -1',
    'try {',
    tests,
    '  return { matchedIndex: -1 }',
    '} catch (__simConditionError) {',
    '  return {',
    '    matchedIndex: -1,',
    '    threwAtIndex: __simConditionIndex,',
    '    message:',
    '      __simConditionError && __simConditionError.message',
    '        ? String(__simConditionError.message)',
    '        : String(__simConditionError),',
    '  }',
    '}',
  ].join('\n')
}

/**
 * Narrows the secrets a condition evaluation can read to the ones its script names.
 *
 * A condition reaches a secret by writing `{{NAME}}`, which the execution-boundary compiler
 * binds. Nothing else in the script needs the workspace's other secrets, so handing the
 * sandbox the full environment only widens what a future defect in this path could reach —
 * the whole map was readable as the `environmentVariables` global.
 *
 * Neither signal is read from the built script, which also carries the source block's output as
 * data. Reading that data would let it decide what the sandbox holds — a payload containing
 * `{{SECRET}}` would mount that secret and have the compiler expand it beside the payload.
 * Placeholders are therefore read from the expressions, which is where every legitimate route
 * to a secret passes, including a workflow variable holding `{{NAME}}`: the resolver inlines
 * that value into the expression before this runs.
 *
 * A direct read of the environment map is not read from the resolved expression either, for the
 * same reason one step further in: resolved data is quoted inside it, so a payload containing
 * the word would be indistinguishable from the author reaching for the map. The resolver
 * records the answer from the author's pre-resolution text instead. When that record is absent
 * — a caller that did not resolve through it — the expression is scanned as a fallback, because
 * narrowing a read this missed would route the run down a branch the author did not write,
 * silently, while matching too widely only costs the narrowing.
 */
function scopeConditionSecrets(conditions: ConditionEntry[]): {
  secretScope: 'all' | 'selected'
  mountedSecrets: string[]
} {
  const readsEnvironment = conditions.some((condition) => {
    const recorded = condition[CONDITION_READS_ENVIRONMENT_KEY]
    return recorded ?? /\benvironmentVariables\b/.test(condition.value)
  })
  if (readsEnvironment) {
    return { secretScope: 'all', mountedSecrets: [] }
  }

  const named = new Set<string>()
  for (const condition of conditions) {
    for (const match of String(condition.value ?? '').matchAll(createEnvVarPattern())) {
      named.add(String(match[1]).trim())
    }
  }
  return { secretScope: 'selected', mountedSecrets: [...named] }
}

/**
 * Runs condition code through the shared function execution boundary.
 *
 * `blockData` is deliberately empty: the resolver already inlines every
 * `<block.field>` reference into the expression before this runs, so shipping
 * the run's accumulated block outputs would only inflate the request body.
 * Sending them blew the 10MB body cap on wide subflows, where a single flat
 * `blockStates` map holds every branch's outputs.
 */
async function runConditionCode(
  ctx: ExecutionContext,
  code: string,
  conditions: ConditionEntry[],
  currentNodeId?: string
): Promise<ToolResponse> {
  const { blockNameMapping, blockOutputSchemas } = collectBlockData(ctx, currentNodeId)
  const { secretScope, mountedSecrets } = scopeConditionSecrets(conditions)

  return executeTool(
    'function_execute',
    {
      code,
      timeout: CONDITION_TIMEOUT_MS,
      secretScope,
      mountedSecrets,
      envVars: normalizeStringRecord(ctx.environmentVariables),
      workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
      blockData: {},
      blockNameMapping,
      blockOutputSchemas,
      _context: {
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        isDeployedContext: ctx.isDeployedContext,
        enforceCredentialAccess: ctx.enforceCredentialAccess,
      },
    },
    { executionContext: ctx }
  )
}

/**
 * A failed batch normally falls back to one call per condition, which is exactly
 * what this handler did before batching. A timeout is the one failure where that
 * is the wrong move: the fallback would re-run every remaining condition against
 * the same stalled transport, turning one slow call into as many slow calls as
 * there are branches. Classified by message because the transport reports giving
 * up as text, the same way `isRetryableFailure` does in `@/tools`.
 */
function isTimeoutFailure(error: string | undefined): boolean {
  if (!error) return false
  const message = error.toLowerCase()
  return message.includes('timed out') || message.includes('timeout')
}

/** Evaluates the whole condition list in a single function execution. */
async function evaluateConditionList(
  ctx: ExecutionContext,
  conditions: ConditionEntry[],
  evalContext: Record<string, unknown>,
  currentNodeId?: string
): Promise<ConditionEvaluation> {
  const expressions = conditions.map((condition) => String(condition.value || ''))
  const result = await runConditionCode(
    ctx,
    buildConditionScript(expressions, evalContext),
    conditions,
    currentNodeId
  )

  if (!result.success) {
    const message = result.error ?? 'Condition evaluation failed'
    return {
      status: 'no-verdict',
      message,
      retryable: result.retryable !== false,
      timedOut: isTimeoutFailure(result.error),
    }
  }

  const output = result.output?.result
  if (!output || typeof output !== 'object') {
    return {
      status: 'no-verdict',
      message: 'Condition evaluation returned no verdict',
      retryable: true,
      timedOut: false,
    }
  }

  const { matchedIndex, threwAtIndex, message } = output as {
    matchedIndex?: unknown
    threwAtIndex?: unknown
    message?: unknown
  }

  if (typeof threwAtIndex === 'number' && threwAtIndex >= 0) {
    if (threwAtIndex >= expressions.length) {
      return {
        status: 'no-verdict',
        message: 'Condition evaluation reported an unknown branch',
        retryable: true,
        timedOut: false,
      }
    }
    return {
      status: 'expression-threw',
      index: threwAtIndex,
      message: typeof message === 'string' && message ? message : 'Unknown evaluation error',
    }
  }

  // The script always reports a `matchedIndex`, so anything else is a response
  // this handler did not produce. Treating that as "no branch matched" would
  // silently route the run down the else path on a garbled reply.
  if (typeof matchedIndex !== 'number') {
    return {
      status: 'no-verdict',
      message: 'Condition evaluation returned an unrecognized verdict',
      retryable: true,
      timedOut: false,
    }
  }
  if (matchedIndex < 0) {
    return { status: 'no-match' }
  }
  if (matchedIndex >= expressions.length) {
    return {
      status: 'no-verdict',
      message: 'Condition evaluation matched an unknown branch',
      retryable: true,
      timedOut: false,
    }
  }

  return { status: 'matched', index: matchedIndex }
}

/**
 * Evaluates one expression in its own call. Kept as the fallback for a batch
 * that produced no verdict: a syntax error anywhere in the list fails the whole
 * script at parse time, while evaluating one at a time only reaches — and so
 * only fails on — the branches the run actually takes.
 */
async function evaluateSingleCondition(
  ctx: ExecutionContext,
  condition: ConditionEntry,
  evalContext: Record<string, unknown>,
  currentNodeId?: string
): Promise<boolean> {
  const expression = String(condition.value || '')
  const code = `const context = ${JSON.stringify(evalContext)};\nreturn ${buildBooleanTest(expression)}`
  const result = await runConditionCode(ctx, code, [condition], currentNodeId)

  if (!result.success) {
    if (result.retryable === false) {
      throw new NonRetryableExecutionError(result.error ?? 'Condition evaluation is indeterminate')
    }
    throw new Error(result.error ?? 'Condition evaluation failed')
  }

  return Boolean(result.output?.result)
}

function conditionError(condition: ConditionEntry, message: string, cause?: unknown): Error {
  return new Error(`Evaluation error in condition "${condition.title}": ${message}`, { cause })
}

/**
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CONDITION
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const conditions = this.parseConditions(inputs.conditions)

    const baseBlockId = extractBaseBlockId(block.id)
    const branchIndex = isBranchNodeId(block.id) ? extractBranchIndex(block.id) : null

    const sourceConnection = ctx.workflow?.connections.find((conn) => conn.target === baseBlockId)
    let sourceBlockId = sourceConnection?.source

    if (sourceBlockId && branchIndex !== null) {
      const virtualSourceId = buildBranchNodeId(sourceBlockId, branchIndex)
      if (ctx.blockStates.has(virtualSourceId)) {
        sourceBlockId = virtualSourceId
      }
    }

    const evalContext = this.buildEvaluationContext(ctx, sourceBlockId)
    const rawSourceOutput = sourceBlockId ? ctx.blockStates.get(sourceBlockId)?.output : null

    const sourceOutput = this.filterSourceOutput(rawSourceOutput)

    const outgoingConnections = ctx.workflow?.connections.filter(
      (conn) => conn.source === baseBlockId
    )

    const { selectedConnection, selectedCondition, conditionResult } =
      await this.evaluateConditions(
        conditions,
        outgoingConnections || [],
        evalContext,
        ctx,
        block.id
      )

    if (!selectedCondition) {
      return {
        ...((sourceOutput as any) || {}),
        conditionResult: false,
        selectedPath: null,
        selectedOption: null,
        selectedTitle: null,
      }
    }

    if (!selectedConnection) {
      const decisionKey = ctx.currentVirtualBlockId || block.id
      ctx.decisions.condition.set(decisionKey, selectedCondition.id)
      return {
        ...((sourceOutput as any) || {}),
        conditionResult,
        selectedPath: null,
        selectedOption: selectedCondition.id,
        selectedTitle: selectedCondition.title,
      }
    }

    const targetBlock = ctx.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    const decisionKey = ctx.currentVirtualBlockId || block.id
    ctx.decisions.condition.set(decisionKey, selectedCondition.id)

    return {
      ...((sourceOutput as any) || {}),
      conditionResult,
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.id || DEFAULTS.BLOCK_TYPE,
        blockTitle: targetBlock.metadata?.name || DEFAULTS.BLOCK_TITLE,
      },
      selectedOption: selectedCondition.id,
      selectedTitle: selectedCondition.title,
    }
  }

  private filterSourceOutput(output: any): any {
    if (!output || typeof output !== 'object') {
      return output
    }
    const { _pauseMetadata, error, providerTiming, tokens, toolCalls, model, cost, ...rest } =
      output
    return rest
  }

  private parseConditions(input: any): ConditionEntry[] {
    try {
      const conditions = Array.isArray(input) ? input : JSON.parse(input || '[]')
      return conditions
    } catch (error: any) {
      logger.error('Failed to parse conditions', {
        errorName: error?.name,
        inputType: Array.isArray(input) ? 'array' : typeof input,
        inputLength: typeof input === 'string' ? input.length : undefined,
      })
      throw new Error(`Invalid conditions format: ${error.message}`)
    }
  }

  private buildEvaluationContext(
    ctx: ExecutionContext,
    sourceBlockId?: string
  ): Record<string, unknown> {
    let evalContext: Record<string, unknown> = {}

    if (sourceBlockId) {
      const sourceOutput = ctx.blockStates.get(sourceBlockId)?.output
      if (sourceOutput && typeof sourceOutput === 'object' && sourceOutput !== null) {
        evalContext = {
          ...evalContext,
          ...sourceOutput,
        }
      }
    }

    return evalContext
  }

  /**
   * An else branch wins as soon as it is reached, so only the branches ahead of
   * it are ever testable — matching the original loop, which returned on the
   * first else it walked past rather than assuming else comes last.
   */
  private async evaluateConditions(
    conditions: ConditionEntry[],
    outgoingConnections: Array<{ source: string; target: string; sourceHandle?: string }>,
    evalContext: Record<string, unknown>,
    ctx: ExecutionContext,
    currentNodeId?: string
  ): Promise<{
    selectedConnection: { target: string; sourceHandle?: string } | null
    selectedCondition: ConditionEntry | null
    /**
     * The chosen branch's own test. Only a matched expression is a truthy test:
     * the else branch fires precisely because every test was false, so reporting
     * it as `true` inverted a downstream `<gate.conditionResult>` on the else
     * path — and persisted the inversion into the trace.
     */
    conditionResult: boolean
  }> {
    const elseIndex = conditions.findIndex((condition) => isElseConditionTitle(condition.title))
    const testable = elseIndex === -1 ? conditions : conditions.slice(0, elseIndex)
    const elseCondition = elseIndex === -1 ? null : conditions[elseIndex]

    const matched = await this.findMatchingCondition(testable, evalContext, ctx, currentNodeId)
    const selectedCondition = matched ?? elseCondition

    if (!selectedCondition) {
      return { selectedConnection: null, selectedCondition: null, conditionResult: false }
    }

    return {
      selectedConnection:
        this.findConnectionForCondition(outgoingConnections, selectedCondition.id) ?? null,
      selectedCondition,
      conditionResult: matched !== null,
    }
  }

  private async findMatchingCondition(
    conditions: ConditionEntry[],
    evalContext: Record<string, unknown>,
    ctx: ExecutionContext,
    currentNodeId?: string
  ): Promise<ConditionEntry | null> {
    if (conditions.length === 0) return null

    let evaluation: ConditionEvaluation
    try {
      evaluation = await evaluateConditionList(ctx, conditions, evalContext, currentNodeId)
    } catch (error) {
      if (isNonRetryableExecutionError(error)) throw error
      evaluation = {
        status: 'no-verdict',
        message: getErrorMessage(error, 'Condition evaluation failed'),
        retryable: true,
        timedOut: false,
      }
    }

    switch (evaluation.status) {
      case 'matched':
        return conditions[evaluation.index]
      case 'no-match':
        return null
      case 'expression-threw':
        logger.error('Failed to evaluate condition', { conditionCount: conditions.length })
        throw conditionError(conditions[evaluation.index], evaluation.message)
      case 'no-verdict':
        if (!evaluation.retryable) {
          throw new NonRetryableExecutionError(
            `Evaluation error in condition "${conditions[0].title}": ${evaluation.message}`
          )
        }
        // Retrying one branch at a time is what recovers a batch the sandbox
        // could not parse. It is the wrong move for a stalled transport, which
        // would re-run every branch against the same stall, or for a cancelled
        // run, where every retry aborts on arrival — both surface the batch
        // failure as it stands. The whole list was one call, so no single
        // branch owns that failure; name the first, where evaluation started.
        if (evaluation.timedOut || ctx.abortSignal?.aborted) {
          logger.error('Failed to evaluate conditions', { conditionCount: conditions.length })
          throw conditionError(conditions[0], evaluation.message)
        }
        logger.warn('Batched condition evaluation produced no verdict, retrying one at a time', {
          conditionCount: conditions.length,
        })
        return this.findMatchingConditionIndividually(conditions, evalContext, ctx, currentNodeId)
    }
  }

  private async findMatchingConditionIndividually(
    conditions: ConditionEntry[],
    evalContext: Record<string, unknown>,
    ctx: ExecutionContext,
    currentNodeId?: string
  ): Promise<ConditionEntry | null> {
    for (const condition of conditions) {
      try {
        const conditionMet = await evaluateSingleCondition(
          ctx,
          condition,
          evalContext,
          currentNodeId
        )
        if (conditionMet) return condition
      } catch (error) {
        logger.error('Failed to evaluate condition', { errorName: toError(error).name })
        throw conditionError(
          condition,
          getErrorMessage(error, 'Condition evaluation failed'),
          error
        )
      }
    }

    return null
  }

  private findConnectionForCondition(
    connections: Array<{ source: string; target: string; sourceHandle?: string }>,
    conditionId: string
  ): { target: string; sourceHandle?: string } | undefined {
    return connections.find(
      (conn) => conn.sourceHandle === `${EDGE.CONDITION_PREFIX}${conditionId}`
    )
  }
}
