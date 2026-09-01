import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { mergeLargeValueKeys } from '@/lib/execution/payloads/access-keys'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  containsLargeValueRef,
  formatLargeValueSize,
  getLargeValueMaterializationError,
  isLargeValueRef,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import {
  createSandboxFileMountRef,
  isSandboxFileMountRef,
} from '@/lib/execution/payloads/sandbox-file-mount-ref'
import { isLikelyReferenceSegment } from '@/lib/workflows/sanitization/references'
import { BlockType, parseReferencePath, REFERENCE } from '@/executor/constants'
import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext, UserFile } from '@/executor/types'
import {
  escapeInertStringContent,
  formatInertStringLiteral,
} from '@/executor/utils/code-formatting'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { BlockResolver } from '@/executor/variables/resolvers/block'
import { EnvResolver } from '@/executor/variables/resolvers/env'
import { LoopResolver } from '@/executor/variables/resolvers/loop'
import { ParallelResolver } from '@/executor/variables/resolvers/parallel'
import {
  type AsyncPathNavigator,
  RESOLVED_EMPTY,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import { WorkflowResolver } from '@/executor/variables/resolvers/workflow'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * Marks a Condition branch whose author-written expression reads the environment map.
 *
 * Carried per branch because only the pre-resolution text can answer it: the handler decides
 * which secrets to mount, and by the time it runs, resolved trigger data quoted inside the
 * expression would read the same as the author reaching for the map.
 */
export const CONDITION_READS_ENVIRONMENT_KEY = '_readsEnvironmentVariables'

/** The sandbox global holding the run's secrets, in whatever shape an expression reaches it. */
const ENVIRONMENT_MAP_IDENTIFIER = /\benvironmentVariables\b/g

/** Key used to carry pre-resolved context variables through the inputs map. */
export const FUNCTION_BLOCK_CONTEXT_VARS_KEY = '_runtimeContextVars'
/** Key used to carry display-resolved code through the function execution path. */
export const FUNCTION_BLOCK_DISPLAY_CODE_KEY = '_runtimeDisplayCode'

const logger = createLogger('VariableResolver')

/**
 * Combined inline budget (data + display source) for a function block's resolved
 * block-output context values. Internal routes cap request bodies at ~10 MB, and a
 * resolved block reference is serialized into the function request both as data
 * (`contextVariables`) and as a literal in the display source, so it costs roughly
 * twice its size. Keeping the inline footprint under this budget leaves headroom for
 * the code, params, and environment variables in the same body. Values that would
 * overflow the budget are offloaded to durable large-value refs and lazily re-read in
 * the sandbox via the `sim.values.read` broker.
 */
const FUNCTION_CONTEXT_INLINE_BUDGET_BYTES = 6 * 1024 * 1024

interface FunctionContextOffloadState {
  inlineFootprintRemaining: number
}

function createFunctionContextOffloadState(): FunctionContextOffloadState {
  return { inlineFootprintRemaining: FUNCTION_CONTEXT_INLINE_BUDGET_BYTES }
}

function measureJson(value: unknown): { json: string; size: number } | null {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) {
      return null
    }
    return { json, size: Buffer.byteLength(json, 'utf8') }
  } catch {
    return null
  }
}

function getNestedLargeValueMaterializationError(): Error {
  return new Error(
    'This execution value contains nested large values. Reference the nested field directly so it can be lazy-loaded.'
  )
}

async function replaceValidReferencesAsync(
  template: string,
  replacer: (match: string, index: number, template: string) => Promise<string>
): Promise<string> {
  const pattern = createReferencePattern()
  let cursor = 0
  let result = ''
  for (const match of template.matchAll(pattern)) {
    const fullMatch = match[0]
    const index = match.index ?? 0
    result += template.slice(cursor, index)
    result += isLikelyReferenceSegment(fullMatch)
      ? await replacer(fullMatch, index, template)
      : fullMatch
    cursor = index + fullMatch.length
  }
  return result + template.slice(cursor)
}

async function replaceEnvVarsAsync(
  template: string,
  replacer: (match: string) => Promise<string>
): Promise<string> {
  const pattern = createEnvVarPattern()
  let cursor = 0
  let result = ''
  for (const match of template.matchAll(pattern)) {
    const fullMatch = match[0]
    const index = match.index ?? 0
    result += template.slice(cursor, index)
    result += await replacer(fullMatch)
    cursor = index + fullMatch.length
  }
  return result + template.slice(cursor)
}

/**
 * A number, boolean, or null literal, optionally padded with spaces or tabs.
 *
 * Every character this admits — digits, `.`, `-`, `+`, `e`, the three keywords, spaces, and
 * tabs — is inert in both places a Condition placeholder can land. In expression position none
 * of them introduces an operator or a comment; inside a string literal none of them terminates
 * it. Padding is admitted rather than trimmed so the inlined text stays byte-identical to the
 * stored value: whitespace is meaningless in expression position but significant inside a
 * quoted string, and only the untrimmed value is correct in both. Line terminators stay out —
 * a raw newline would break a single-quoted string.
 */
const STRUCTURALLY_INERT_CONDITION_LITERAL =
  /^[ \t]*(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null)[ \t]*$/

/**
 * Whether an environment variable value may be inlined into a Condition expression as source.
 *
 * Condition expressions are user-authored JavaScript, so an inlined value is parsed as code.
 * Only self-contained literals are safe to inline; every other value keeps its `{{NAME}}`
 * placeholder and is bound as a string by the execution-boundary compiler instead. That keeps
 * `{{COUNT}} === 3` and `{{ENABLED}} === true` comparing as literals — the long-standing
 * behavior — while a value containing a quote, newline, or operator can no longer break the
 * expression or forge its result.
 */
function isStructurallyInertConditionLiteral(value: string): boolean {
  return STRUCTURALLY_INERT_CONDITION_LITERAL.test(value)
}

type ShellQuoteContext = 'single' | 'double' | null
type CodeStringQuoteContext =
  | ShellQuoteContext
  | 'triple-single'
  | 'triple-double'
  | 'template'
  | 'regex'
type CodeScanMode =
  | { type: 'normal' }
  | { type: 'single' }
  | { type: 'double' }
  | { type: 'triple-single' }
  | { type: 'triple-double' }
  | { type: 'template' }
  | { type: 'template-expression'; depth: number }
  | { type: 'line-comment' }
  | { type: 'block-comment' }
  | { type: 'regex'; inCharacterClass: boolean }

/**
 * Characters after which a `/` opens a regular expression rather than dividing.
 *
 * The scanner has to tell the two apart, because a regex body is the one place a lone quote
 * is not a string delimiter: `/['"]/` left the scan believing everything after it sat inside
 * a string, and every reference past that point was then formatted for the wrong context.
 * Division always follows a value — an identifier, literal, `)`, or `]` — so anything else
 * ending the preceding token means a regex may start.
 *
 * `)` is the one that is not decidable from the character alone: it ends a value in
 * `(a + b) / 2` and a control-flow head in `if (a) /re/.test(b)`. Reading it as either one
 * unconditionally breaks the other, so the scan remembers which kind of parenthesis each `)`
 * closed rather than guessing — see {@link CONTROL_FLOW_HEAD_KEYWORDS}.
 */
const JAVASCRIPT_REGEX_ALLOWED_AFTER = new Set('(,=:[!&|?{};+-*%^~<>/'.split(''))

/** Keywords whose parenthesized head is followed by a statement, where a regex may start. */
const CONTROL_FLOW_HEAD_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'with'])

const WHITESPACE_CHAR = /\s/

/** Keywords a regex may directly follow, where the preceding token is a word rather than punctuation. */
const JAVASCRIPT_REGEX_ALLOWED_AFTER_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'throw',
  'do',
  'else',
  'yield',
  'await',
])

export class VariableResolver {
  private resolvers: Resolver[]
  private blockResolver: BlockResolver

  constructor(
    workflow: SerializedWorkflow,
    workflowVariables: Record<string, any>,
    private state: ExecutionState,
    options: { navigatePathAsync?: AsyncPathNavigator } = {}
  ) {
    this.blockResolver = new BlockResolver(workflow, options.navigatePathAsync)
    this.resolvers = [
      new LoopResolver(workflow, options.navigatePathAsync),
      new ParallelResolver(workflow, options.navigatePathAsync),
      new WorkflowResolver(workflowVariables, options.navigatePathAsync),
      new EnvResolver(),
      this.blockResolver,
    ]
  }

  /**
   * Resolves inputs for function blocks. Block output references in the `code` field
   * are stored as named context variables instead of being embedded as JavaScript
   * literals, preventing large values from bloating the code string.
   *
   * Returns runtime inputs, display inputs, and a `contextVariables` map. Callers
   * should inject contextVariables into the function execution request body so the
   * runtime can access them as globals. Environment placeholders remain in source so
   * the shared execution-boundary compiler handles both Function blocks and Custom Tools.
   */
  async resolveInputsForFunctionBlock(
    ctx: ExecutionContext,
    currentNodeId: string,
    params: Record<string, any> | null | undefined,
    block: SerializedBlock
  ): Promise<{
    resolvedInputs: Record<string, any>
    displayInputs: Record<string, any>
    contextVariables: Record<string, unknown>
  }> {
    const contextVariables: Record<string, unknown> = {}
    const resolved: Record<string, any> = {}
    const display: Record<string, any> = {}
    const offloadState = createFunctionContextOffloadState()

    if (!params) {
      return { resolvedInputs: resolved, displayInputs: display, contextVariables }
    }

    for (const [key, value] of Object.entries(params)) {
      if (key === 'code') {
        if (typeof value === 'string') {
          const code = await this.resolveCodeWithContextVars(
            ctx,
            currentNodeId,
            value,
            undefined,
            block,
            contextVariables,
            offloadState
          )
          resolved[key] = code.resolvedCode
          display[key] = code.displayCode
        } else if (Array.isArray(value)) {
          const resolvedItems: any[] = []
          const displayItems: any[] = []
          for (const item of value) {
            if (item && typeof item === 'object' && typeof item.content === 'string') {
              const code = await this.resolveCodeWithContextVars(
                ctx,
                currentNodeId,
                item.content,
                undefined,
                block,
                contextVariables,
                offloadState
              )
              resolvedItems.push({
                ...item,
                content: code.resolvedCode,
              })
              displayItems.push({
                ...item,
                content: code.displayCode,
              })
              continue
            }
            resolvedItems.push(item)
            displayItems.push(item)
          }
          resolved[key] = resolvedItems
          display[key] = displayItems
        } else {
          resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block, {
            inputPath: [key],
          })
          display[key] = resolved[key]
        }
      } else {
        resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block, {
          inputPath: [key],
        })
        display[key] = resolved[key]
      }
    }

    return { resolvedInputs: resolved, displayInputs: display, contextVariables }
  }

  async resolveInputs(
    ctx: ExecutionContext,
    currentNodeId: string,
    params: Record<string, any>,
    block?: SerializedBlock
  ): Promise<Record<string, any>> {
    if (!params) {
      return {}
    }
    const resolved: Record<string, any> = {}

    const isConditionBlock = block?.metadata?.id === BlockType.CONDITION
    if (isConditionBlock) {
      let conditions: unknown = params.conditions
      if (typeof conditions === 'string') {
        try {
          const parsedConditions: unknown = JSON.parse(conditions)
          if (Array.isArray(parsedConditions)) conditions = parsedConditions
        } catch (parseError) {
          conditions = params.conditions
          logger.warn('Failed to parse conditions JSON, falling back to normal resolution', {
            errorName: toError(parseError).name,
            inputLength: params.conditions.length,
          })
        }
      }

      if (Array.isArray(conditions)) {
        resolved.conditions = await Promise.all(
          conditions.map(async (condition, conditionIndex) => {
            if (!condition || typeof condition !== 'object') return condition
            const value = Reflect.get(condition, 'value')
            return {
              ...condition,
              // Recorded before resolution: once values are inlined, an expression that reads
              // the environment map is indistinguishable from one that merely quotes trigger
              // data containing the word, and the handler decides what to mount from this.
              [CONDITION_READS_ENVIRONMENT_KEY]:
                typeof value === 'string' && this.readsEnvironmentMap(value),
              value:
                typeof value === 'string'
                  ? await this.resolveTemplateWithoutConditionFormatting(
                      ctx,
                      currentNodeId,
                      value,
                      undefined,
                      ['conditions', String(conditionIndex), 'value']
                    )
                  : value,
            }
          })
        )
      } else {
        resolved.conditions = await this.resolveValue(
          ctx,
          currentNodeId,
          conditions,
          undefined,
          block,
          { inputPath: ['conditions'] }
        )
      }
    }

    for (const [key, value] of Object.entries(params)) {
      if (isConditionBlock && key === 'conditions') {
        continue
      }
      resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block, {
        allowLargeValueRefs: this.canResolveInputToLargeValueRef(block, key),
        inputPath: [key],
      })
    }
    return resolved
  }

  private canResolveInputToLargeValueRef(block: SerializedBlock | undefined, key: string): boolean {
    if (block?.metadata?.id === BlockType.VARIABLES) {
      return key === 'variables'
    }

    if (block?.metadata?.id === BlockType.RESPONSE) {
      return key === 'data' || key === 'builderData'
    }

    return false
  }

  async resolveSingleReference(
    ctx: ExecutionContext,
    currentNodeId: string,
    reference: string,
    loopScope?: LoopScope,
    options: { allowLargeValueRefs?: boolean; inputPath?: readonly string[] } = {}
  ): Promise<any> {
    if (typeof reference === 'string') {
      const trimmed = reference.trim()
      if (/^<[^<>]+>$/.test(trimmed)) {
        const resolutionContext: ResolutionContext = {
          executionContext: ctx,
          executionState: this.state,
          currentNodeId,
          loopScope,
          allowLargeValueRefs: options.allowLargeValueRefs,
          inputPath: options.inputPath,
        }

        const result = await this.resolveReference(trimmed, resolutionContext)
        const resolved = result === RESOLVED_EMPTY ? null : result
        ctx.resolvedSecretTraceRegistry?.recordResolvedInputProjection(
          options.inputPath,
          resolved,
          trimmed
        )
        return resolved
      }
    }

    return this.resolveValue(ctx, currentNodeId, reference, loopScope, undefined, options)
  }

  private async resolveValue(
    ctx: ExecutionContext,
    currentNodeId: string,
    value: any,
    loopScope?: LoopScope,
    block?: SerializedBlock,
    options: { allowLargeValueRefs?: boolean; inputPath?: readonly string[] } = {}
  ): Promise<any> {
    if (value === null || value === undefined) {
      return value
    }

    if (Array.isArray(value)) {
      return Promise.all(
        value.map((v, index) =>
          this.resolveValue(ctx, currentNodeId, v, loopScope, block, {
            ...options,
            inputPath: options.inputPath ? [...options.inputPath, String(index)] : undefined,
          })
        )
      )
    }

    if (typeof value === 'object') {
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, val]) => {
          const resolvedValue = await this.resolveValue(ctx, currentNodeId, val, loopScope, block, {
            ...options,
            inputPath: options.inputPath ? [...options.inputPath, key] : undefined,
          })
          return [key, resolvedValue]
        })
      )
      return Object.fromEntries(entries)
    }

    if (typeof value === 'string') {
      return this.resolveTemplate(ctx, currentNodeId, value, loopScope, block, options)
    }
    return value
  }
  /**
   * Resolves a code template for a function block. Block output references are stored
   * in `contextVarAccumulator` as named variables (e.g. `__blockRef_0`) and replaced
   * with those variable names in the returned code string. Environment placeholders are
   * deliberately preserved for the shared execution-boundary compiler.
   */
  private async resolveCodeWithContextVars(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope: LoopScope | undefined,
    block: SerializedBlock,
    contextVarAccumulator: Record<string, unknown>,
    offloadState: FunctionContextOffloadState = createFunctionContextOffloadState()
  ): Promise<{ resolvedCode: string; displayCode: string }> {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
      allowLargeValueRefs: true,
    }

    const language = (block.config?.params as Record<string, unknown> | undefined)?.language as
      | string
      | undefined

    let replacementError: Error | null = null
    let displayResult = ''
    let displayCursor = 0

    const result = await replaceValidReferencesAsync(template, async (match, index) => {
      if (replacementError) return match
      displayResult += template.slice(displayCursor, index)
      displayCursor = index + match.length

      try {
        const sandboxFilePath = await this.resolveSandboxFilePathReference(
          match,
          resolutionContext,
          language,
          template,
          index,
          contextVarAccumulator
        )
        if (sandboxFilePath) {
          displayResult += sandboxFilePath.display
          return sandboxFilePath.replacement
        }

        const lazyBase64 = await this.resolveLazyFileBase64Reference(
          match,
          resolutionContext,
          language,
          template,
          index,
          contextVarAccumulator
        )
        if (lazyBase64) {
          displayResult += lazyBase64.display
          return lazyBase64.replacement
        }

        if (this.blockResolver.canResolve(match)) {
          const resolved = await this.resolveReference(match, resolutionContext)
          if (resolved === undefined) {
            displayResult += match
            return match
          }

          const effectiveValue = resolved === RESOLVED_EMPTY ? null : resolved

          // Block output: store in contextVarAccumulator and replace the reference
          // with language-specific runtime access to that stored value.
          const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
          let replacement: string
          // `storedValue` is placed in contextVarAccumulator and `displayValue` is
          // rendered into the display source. They diverge only when an oversized
          // inline value is offloaded to a ref (both then carry the small ref).
          let storedValue: unknown = effectiveValue
          let displayValue: unknown = effectiveValue
          if (isLargeValueRef(effectiveValue)) {
            const lazyReplacement = this.formatLazyLargeValueReference(
              varName,
              language,
              template,
              index
            )
            if (!lazyReplacement) {
              throw getLargeValueMaterializationError(effectiveValue)
            }
            replacement = lazyReplacement
          } else if (isLargeArrayManifest(effectiveValue)) {
            const lazyReplacement = this.formatLazyLargeArrayManifestReference(
              varName,
              language,
              template,
              index
            )
            if (!lazyReplacement) {
              throw getNestedLargeValueMaterializationError()
            }
            replacement = lazyReplacement
          } else if (containsLargeValueRef(effectiveValue)) {
            throw getNestedLargeValueMaterializationError()
          } else {
            const offloadedRef = await this.maybeOffloadInlineFunctionContextValue(
              ctx,
              effectiveValue,
              language,
              template,
              offloadState
            )
            if (offloadedRef) {
              storedValue = offloadedRef
              displayValue = offloadedRef
              // maybeOffload only returns a ref when the JS runtime helpers are usable —
              // the same guard formatLazyLargeValueReference needs — so it is non-null here.
              replacement =
                this.formatLazyLargeValueReference(varName, language, template, index) ??
                this.formatContextVariableReference(
                  varName,
                  language,
                  template,
                  index,
                  effectiveValue
                )
            } else {
              replacement = this.formatContextVariableReference(
                varName,
                language,
                template,
                index,
                effectiveValue
              )
            }
          }
          contextVarAccumulator[varName] = storedValue
          displayResult += this.formatDisplayValueForCodeContext(
            displayValue,
            language,
            template,
            index
          )
          return replacement
        }

        const resolved = await this.resolveReference(match, resolutionContext)
        if (resolved === undefined) {
          displayResult += match
          return match
        }

        const effectiveValue = resolved === RESOLVED_EMPTY ? null : resolved

        if (isLargeValueRef(effectiveValue)) {
          const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
          contextVarAccumulator[varName] = effectiveValue
          const lazyReplacement = this.formatLazyLargeValueReference(
            varName,
            language,
            template,
            index
          )
          if (lazyReplacement) {
            displayResult += this.formatDisplayValueForCodeContext(
              effectiveValue,
              language,
              template,
              index
            )
            return lazyReplacement
          }
          throw getLargeValueMaterializationError(effectiveValue)
        }

        if (isLargeArrayManifest(effectiveValue)) {
          const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
          contextVarAccumulator[varName] = effectiveValue
          const lazyReplacement = this.formatLazyLargeArrayManifestReference(
            varName,
            language,
            template,
            index
          )
          if (lazyReplacement) {
            displayResult += this.formatDisplayValueForCodeContext(
              effectiveValue,
              language,
              template,
              index
            )
            return lazyReplacement
          }
          throw getNestedLargeValueMaterializationError()
        }

        if (containsLargeValueRef(effectiveValue)) {
          throw getNestedLargeValueMaterializationError()
        }

        if (this.canInlineResolvedCodeLiteral(effectiveValue, match)) {
          const replacement = this.blockResolver.formatValueForBlock(
            effectiveValue,
            BlockType.FUNCTION,
            language
          )
          displayResult += replacement
          return replacement
        }

        const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
        contextVarAccumulator[varName] = effectiveValue
        const replacement = this.formatContextVariableReference(
          varName,
          language,
          template,
          index,
          effectiveValue
        )
        displayResult += this.formatDisplayValueForCodeContext(
          effectiveValue,
          language,
          template,
          index
        )
        return replacement
      } catch (error) {
        replacementError = error instanceof Error ? error : new Error(String(error))
        displayResult += match
        return match
      }
    })
    displayResult += template.slice(displayCursor)

    if (replacementError !== null) {
      throw replacementError
    }

    return { resolvedCode: result, displayCode: displayResult }
  }

  /**
   * Resolves `<block.file.path>` to the file's location on the sandbox filesystem.
   *
   * The counterpart to the `base64` reference above, and deliberately unlike it in
   * two ways. It is not gated on the JavaScript runtime helpers, because a path is
   * just a string and Python and Shell need it more than JavaScript does. And it
   * stores a mount marker rather than the path itself: the sandbox does not exist
   * yet at resolution time, and paths are assigned only once the whole mount set is
   * known, since they are sanitized and de-duplicated together.
   */
  private async resolveSandboxFilePathReference(
    reference: string,
    context: ResolutionContext,
    language: string | undefined,
    template: string,
    matchIndex: number,
    contextVarAccumulator: Record<string, unknown>
  ): Promise<{ replacement: string; display: string } | null> {
    const parts = parseReferencePath(reference)
    if (parts.length < 3 || parts.at(-1) !== 'path') {
      return null
    }

    const fileReference = `${REFERENCE.START}${parts.slice(0, -1).join(REFERENCE.PATH_DELIMITER)}${REFERENCE.END}`
    const file = await this.resolveReference(fileReference, context)
    if (!isUserFileWithMetadata(file) || !file.key) {
      return null
    }

    // Reuse the marker already standing for this file so a path referenced twice
    // costs one context variable rather than two. What keeps it to one mount is
    // `planUserFileMounts`, which collapses by storage key across every source —
    // this only keeps the duplicate out of the request body.
    const existing = Object.entries(contextVarAccumulator).find(
      ([, value]) => isSandboxFileMountRef(value) && value.file.key === file.key
    )
    const varName = existing?.[0] ?? `__blockRef_${Object.keys(contextVarAccumulator).length}`
    if (!existing) {
      // The bytes are fetched into the sandbox, so the inline copy would be dead
      // weight in the request body.
      const { base64: _base64, ...fileMetadata } = file
      contextVarAccumulator[varName] = createSandboxFileMountRef(fileMetadata as UserFile)
    }

    return {
      replacement: this.formatContextVariablePathReference(varName, language, template, matchIndex),
      display: reference,
    }
  }

  /**
   * Formats a mount-path reference for splicing into code.
   *
   * Unlike {@link formatContextVariableReference}, a path inside a quoted string is
   * spliced raw rather than JSON-encoded. The general formatter is right to encode
   * an arbitrary value — the author of `"<block.output>"` wants its JSON form — but
   * a path is always a plain string, so encoding it would put literal quote
   * characters inside the string the code then opens, turning `open('<file.path>')`
   * into a lookup for a filename that begins with `"`.
   *
   * Splicing raw is safe precisely here: mount paths are built segment by segment
   * through `buildStorageKeySegment`, which reduces anything outside
   * `[A-Za-z0-9.-]` to `_`, so the value cannot carry a quote, backslash, backtick,
   * or `$` that would escape the surrounding literal.
   *
   * Shell is delegated unchanged — its formatter already closes and reopens a
   * single-quoted context around a double-quoted expansion, which expands
   * correctly and needs no path-specific case.
   */
  private formatContextVariablePathReference(
    varName: string,
    language: string | undefined,
    template: string,
    matchIndex: number
  ): string {
    if (language === 'shell') {
      return this.formatShellContextVariableReference(varName, template, matchIndex, '')
    }

    const quoteContext = this.getCodeStringQuoteContext(template, matchIndex, language)

    if (language === 'python') {
      const expression = `globals()[${JSON.stringify(varName)}]`
      if (this.isPythonStringQuoteContext(quoteContext)) {
        const quote = this.getCodeStringQuoteToken(quoteContext)
        return `${quote} + ${expression} + ${quote}`
      }
      return expression
    }

    const expression = `globalThis[${JSON.stringify(varName)}]`
    if (quoteContext === 'template') {
      return `\${${expression}}`
    }
    if (quoteContext === 'single' || quoteContext === 'double') {
      const quote = this.getCodeStringQuoteToken(quoteContext)
      return `${quote} + ${expression} + ${quote}`
    }
    return expression
  }

  private async resolveLazyFileBase64Reference(
    reference: string,
    context: ResolutionContext,
    language: string | undefined,
    template: string,
    matchIndex: number,
    contextVarAccumulator: Record<string, unknown>
  ): Promise<{ replacement: string; display: string } | null> {
    if (!this.canUseJavaScriptRuntimeHelpers(language, template)) {
      return null
    }

    const parts = parseReferencePath(reference)
    if (parts.length < 3 || parts.at(-1) !== 'base64') {
      return null
    }

    const fileReference = `${REFERENCE.START}${parts.slice(0, -1).join(REFERENCE.PATH_DELIMITER)}${REFERENCE.END}`
    const file = await this.resolveReference(fileReference, context)
    if (!isUserFileWithMetadata(file)) {
      return null
    }
    if (!file.key) {
      return null
    }

    const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
    const { base64: _base64, ...fileMetadata } = file
    contextVarAccumulator[varName] = fileMetadata
    const fileExpression = `globalThis[${JSON.stringify(varName)}]`
    const lazyExpression = `(await sim.files.readBase64(${fileExpression}))`

    return {
      replacement: this.formatJavaScriptAsyncExpression(lazyExpression, template, matchIndex),
      display: reference,
    }
  }

  /**
   * Offloads an inline function block-output value to a durable large-value ref when
   * keeping it inline would push the function execution request body past its budget.
   *
   * A few medium values merged in one function block (for example two fetched images)
   * can exceed the ~10 MB internal-route body cap even though no single value crosses
   * the per-value large-value threshold. Offloading the overflowing values lets the
   * function runtime lazily re-read them via the `sim.values.read` broker instead of
   * inlining their bytes into the request.
   *
   * Returns the stored reference when offloaded, or `null` to keep the value inline.
   */
  private async maybeOffloadInlineFunctionContextValue(
    ctx: ExecutionContext,
    value: unknown,
    language: string | undefined,
    template: string,
    offloadState: FunctionContextOffloadState
  ): Promise<LargeValueRef | null> {
    // Lazy re-reading is only available in the JavaScript isolated-vm runtime; other
    // runtimes have no broker to materialize a ref, so the value must stay inline.
    if (!this.canUseJavaScriptRuntimeHelpers(language, template)) {
      return null
    }
    if (!ctx.workspaceId || !ctx.workflowId || !ctx.executionId) {
      return null
    }

    const measured = measureJson(value)
    if (measured === null) {
      return null
    }

    // Inline values are serialized into both the request data and the display source.
    const footprint = measured.size * 2
    if (footprint <= offloadState.inlineFootprintRemaining) {
      offloadState.inlineFootprintRemaining -= footprint
      return null
    }

    try {
      const { storeLargeValue } = await import('@/lib/execution/payloads/store')
      const ref = await storeLargeValue(value, measured.json, measured.size, {
        workspaceId: ctx.workspaceId,
        workflowId: ctx.workflowId,
        executionId: ctx.executionId,
        userId: ctx.userId,
        requireDurable: true,
      })
      // Authorize the function route to materialize the ref it is about to receive.
      if (ref.key) {
        mergeLargeValueKeys(ctx, [ref.key])
      }
      return ref
    } catch (error) {
      logger.warn('Failed to offload oversized function context value; keeping inline', {
        error: toError(error).message,
      })
      return null
    }
  }

  private formatLazyLargeValueReference(
    varName: string,
    language: string | undefined,
    template: string,
    matchIndex: number
  ): string | null {
    if (!this.canUseJavaScriptRuntimeHelpers(language, template)) {
      return null
    }

    const expression = `(await sim.values.read(globalThis[${JSON.stringify(varName)}]))`
    return this.formatJavaScriptAsyncExpression(expression, template, matchIndex, {
      stringifyInStringContext: true,
    })
  }

  private formatLazyLargeArrayManifestReference(
    varName: string,
    language: string | undefined,
    template: string,
    matchIndex: number
  ): string | null {
    if (!this.canUseJavaScriptRuntimeHelpers(language, template)) {
      return null
    }

    const expression = `(await sim.values.readArray(globalThis[${JSON.stringify(varName)}]))`
    return this.formatJavaScriptAsyncExpression(expression, template, matchIndex, {
      stringifyInStringContext: true,
    })
  }

  /**
   * Whether a resolved value may stay a literal in generated code rather than being bound
   * as a context variable.
   *
   * Splicing a value into user-authored code hands the author's quoting the decision of how
   * that value parses, so only values that cannot terminate a literal may stay inline.
   * Numbers, booleans, and null render as digits or keywords. A string qualifies only when
   * it names an environment variable and carries no character that could close a string in
   * any supported language: that shape has to stay in source because the placeholder, never
   * the secret, is what gets inlined, and the execution-boundary compiler binds it
   * downstream — that is how `<variable.indirectSecret>` reaches its value.
   *
   * Everything else binds, which is what block outputs have always done. Inlining the rest
   * is what let a runtime-assigned variable or loop item carrying trigger data close the
   * string it landed in and run as code.
   *
   * The placeholder case is admitted only for a workflow variable, never for a loop item or
   * any other run value. Whoever supplies the text picks which secret the compiler expands
   * into the generated source, so that choice stays with the surface an author configures.
   */
  private canInlineResolvedCodeLiteral(value: unknown, reference: string): boolean {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      return true
    }
    if (typeof value !== 'string') {
      return false
    }
    if (parseReferencePath(reference)[0] !== REFERENCE.PREFIX.VARIABLE) {
      return false
    }
    return createEnvVarPattern().test(value) && !/['"`$\\\n\r\u2028\u2029]/.test(value)
  }

  private formatJavaScriptAsyncExpression(
    expression: string,
    template: string,
    matchIndex: number,
    options: { stringifyInStringContext?: boolean } = {}
  ): string {
    const quoteContext = this.getCodeStringQuoteContext(template, matchIndex, 'javascript')
    const stringExpression = options.stringifyInStringContext
      ? `JSON.stringify(${expression})`
      : expression

    if (quoteContext === 'template') {
      return `\${${stringExpression}}`
    }
    if (quoteContext === 'single' || quoteContext === 'double') {
      const quote = this.getCodeStringQuoteToken(quoteContext)
      return `${quote} + ${stringExpression} + ${quote}`
    }
    return expression
  }

  private canUseJavaScriptRuntimeHelpers(language: string | undefined, template: string): boolean {
    if (language !== 'javascript') {
      return false
    }
    return !this.hasJavaScriptModuleDependencySyntax(template)
  }

  private hasJavaScriptModuleDependencySyntax(template: string): boolean {
    const modes: CodeScanMode[] = [{ type: 'normal' }]

    for (let i = 0; i < template.length; i++) {
      const char = template[i]
      const next = template[i + 1]
      const mode = modes[modes.length - 1]

      if (mode.type === 'line-comment') {
        if (char === '\n') modes.pop()
        continue
      }

      if (mode.type === 'block-comment') {
        if (char === '*' && next === '/') {
          modes.pop()
          i++
        }
        continue
      }

      if (mode.type === 'single' || mode.type === 'double') {
        const quote = mode.type === 'single' ? "'" : '"'
        if (char === '\\') {
          i++
          continue
        }
        if (char === quote || char === '\n') modes.pop()
        continue
      }

      if (mode.type === 'template') {
        if (char === '\\') {
          i++
          continue
        }
        if (char === '`') {
          modes.pop()
          continue
        }
        if (char === '$' && next === '{') {
          modes.push({ type: 'template-expression', depth: 1 })
          i++
        }
        continue
      }

      const isCodeMode = mode.type === 'normal' || mode.type === 'template-expression'
      if (!isCodeMode) continue

      if (char === '/' && next === '/') {
        modes.push({ type: 'line-comment' })
        i++
        continue
      }
      if (char === '/' && next === '*') {
        modes.push({ type: 'block-comment' })
        i++
        continue
      }
      if (char === "'") {
        modes.push({ type: 'single' })
        continue
      }
      if (char === '"') {
        modes.push({ type: 'double' })
        continue
      }
      if (char === '`') {
        modes.push({ type: 'template' })
        continue
      }

      if (mode.type === 'template-expression') {
        if (char === '{') {
          mode.depth += 1
          continue
        }
        if (char === '}') {
          mode.depth -= 1
          if (mode.depth === 0) modes.pop()
          continue
        }
      }

      if (this.startsWithStaticImport(template, i) || this.startsWithRequireCall(template, i)) {
        return true
      }
    }

    return false
  }

  private startsWithStaticImport(template: string, index: number): boolean {
    if (!this.matchesKeywordAt(template, index, 'import')) {
      return false
    }
    const nextIndex = this.skipWhitespace(template, index + 'import'.length)
    if (nextIndex === index + 'import'.length) {
      return false
    }
    return template[nextIndex] !== '('
  }

  private startsWithRequireCall(template: string, index: number): boolean {
    if (!this.matchesKeywordAt(template, index, 'require')) {
      return false
    }
    const openParenIndex = this.skipWhitespace(template, index + 'require'.length)
    if (template[openParenIndex] !== '(') {
      return false
    }
    const argumentIndex = this.skipWhitespace(template, openParenIndex + 1)
    return (
      template[argumentIndex] === "'" ||
      template[argumentIndex] === '"' ||
      template[argumentIndex] === '`'
    )
  }

  /**
   * Whether a `/` at this point opens a regular expression rather than dividing.
   *
   * Division always follows a value, so the preceding token decides: an identifier that is not
   * one of the keywords a regex may follow, a number, a `)`, or a `]` means division, and
   * anything else means a regex may start. Guessing wrong is not silent — the scan would swallow
   * text up to the next `/` — so the check reads the actual preceding token rather than assuming.
   */
  private canStartJavaScriptRegex(
    template: string,
    previousSignificantIndex: number,
    closes: { controlHeadParenCloses: ReadonlySet<number>; regexCloseIndices: ReadonlySet<number> }
  ): boolean {
    if (previousSignificantIndex < 0) {
      return true
    }
    const previous = template[previousSignificantIndex]
    if (previous === ')') {
      return closes.controlHeadParenCloses.has(previousSignificantIndex)
    }
    if (previous === '/' && closes.regexCloseIndices.has(previousSignificantIndex)) {
      return false
    }
    // `+` and `-` precede a regex as operators but end a value when doubled: `i++ / 2` divides.
    if (
      (previous === '+' || previous === '-') &&
      template[previousSignificantIndex - 1] === previous
    ) {
      return false
    }
    if (JAVASCRIPT_REGEX_ALLOWED_AFTER.has(previous)) {
      return true
    }
    if (!this.isJavaScriptIdentifierChar(previous)) {
      return false
    }

    let start = previousSignificantIndex
    while (start > 0 && this.isJavaScriptIdentifierChar(template[start - 1])) {
      start--
    }
    return JAVASCRIPT_REGEX_ALLOWED_AFTER_KEYWORDS.has(
      template.slice(start, previousSignificantIndex + 1)
    )
  }

  /**
   * Whether a Condition expression reads the run's secrets off the environment map.
   *
   * The name is only a read where it can execute, so each occurrence is placed with the same
   * scanner that decides how references are spliced — a mention inside a string, a template,
   * or a regex is text and mounts nothing. No shape of the read itself is assumed:
   * `environmentVariables?.FLAG` and `Object.keys(environmentVariables)` both count, because
   * narrowing an expression that does reach the map would route the run down a branch the
   * author did not write, silently, while admitting one too many only costs the narrowing.
   */
  private readsEnvironmentMap(expression: string): boolean {
    ENVIRONMENT_MAP_IDENTIFIER.lastIndex = 0
    let match = ENVIRONMENT_MAP_IDENTIFIER.exec(expression)
    while (match !== null) {
      if (this.getCodeStringQuoteContext(expression, match.index, 'javascript') === null) {
        return true
      }
      match = ENVIRONMENT_MAP_IDENTIFIER.exec(expression)
    }
    return false
  }

  /**
   * Whether a `(` opens a control-flow head rather than a value.
   *
   * What follows the matching `)` differs entirely between the two — a statement, where a regex
   * literal may begin, versus an operator, where a `/` divides — and the closing parenthesis
   * carries no trace of which it was. The keyword in front of the opening one is what tells
   * them apart, so `if (a) /re/.test(b)` and `(a + b) / 2` both scan correctly.
   *
   * Both inputs come from the forward scan rather than a walk back through the source: the
   * scan already knows which characters were code and which sat inside a comment, and reading
   * backwards cannot recover that — the opener of `/* a /* b *\/` is its first delimiter, not
   * its last, and only the scan that passed through knows the difference.
   */
  private opensControlFlowHead(
    template: string,
    previousSignificantIndex: number,
    precededByPropertyAccess: boolean
  ): boolean {
    if (precededByPropertyAccess || previousSignificantIndex < 0) {
      return false
    }
    if (!this.isJavaScriptIdentifierChar(template[previousSignificantIndex])) {
      return false
    }
    let start = previousSignificantIndex
    while (start > 0 && this.isJavaScriptIdentifierChar(template[start - 1])) {
      start--
    }
    return CONTROL_FLOW_HEAD_KEYWORDS.has(template.slice(start, previousSignificantIndex + 1))
  }

  private matchesKeywordAt(template: string, index: number, keyword: string): boolean {
    if (!template.startsWith(keyword, index)) {
      return false
    }
    const before = index > 0 ? template[index - 1] : ''
    const after = template[index + keyword.length] ?? ''
    return !this.isJavaScriptIdentifierChar(before) && !this.isJavaScriptIdentifierChar(after)
  }

  private skipWhitespace(template: string, index: number): number {
    let cursor = index
    while (cursor < template.length && /\s/.test(template[cursor])) {
      cursor++
    }
    return cursor
  }

  private isJavaScriptIdentifierChar(char: string): boolean {
    return /[A-Za-z0-9_$]/.test(char)
  }

  private formatContextVariableReference(
    varName: string,
    language: string | undefined,
    template: string,
    matchIndex: number,
    value: unknown
  ): string {
    if (language === 'python') {
      const expression = `globals()[${JSON.stringify(varName)}]`
      const quoteContext = this.getCodeStringQuoteContext(template, matchIndex, language)
      if (this.isPythonStringQuoteContext(quoteContext)) {
        const quote = this.getCodeStringQuoteToken(quoteContext)
        return `${quote} + json.dumps(${expression}) + ${quote}`
      }
      return expression
    }

    if (language === 'shell') {
      return this.formatShellContextVariableReference(varName, template, matchIndex, value)
    }

    const expression = `globalThis[${JSON.stringify(varName)}]`
    const quoteContext = this.getCodeStringQuoteContext(template, matchIndex, language)
    if (quoteContext === 'template') {
      return `\${JSON.stringify(${expression})}`
    }
    if (quoteContext === 'single' || quoteContext === 'double') {
      const quote = this.getCodeStringQuoteToken(quoteContext)
      return `${quote} + JSON.stringify(${expression}) + ${quote}`
    }
    return expression
  }

  private isPythonStringQuoteContext(
    quoteContext: CodeStringQuoteContext
  ): quoteContext is 'single' | 'double' | 'triple-single' | 'triple-double' {
    return (
      quoteContext === 'single' ||
      quoteContext === 'double' ||
      quoteContext === 'triple-single' ||
      quoteContext === 'triple-double'
    )
  }

  private getCodeStringQuoteToken(
    quoteContext: 'single' | 'double' | 'triple-single' | 'triple-double'
  ): string {
    if (quoteContext === 'single') return "'"
    if (quoteContext === 'double') return '"'
    if (quoteContext === 'triple-single') return "'''"
    return '"""'
  }

  private formatDisplayValueForCodeContext(
    value: unknown,
    language: string | undefined,
    template: string,
    matchIndex: number
  ): string {
    // Offloaded large values carry only a storage ref (or array manifest), never the
    // data itself. Render a concise placeholder for the Input view instead of leaking
    // the internal ref object, which is unreadable and meaningless to a user.
    if (isLargeValueRef(value)) {
      return `/* large ${value.kind} · ${formatLargeValueSize(value.size)}, fetched at runtime */`
    }
    if (isLargeArrayManifest(value)) {
      return `/* large array · ${value.totalCount} items · ${formatLargeValueSize(value.byteSize)}, fetched at runtime */`
    }

    if (language === 'shell') {
      return this.formatShellDisplayValue(value, template, matchIndex)
    }

    return this.blockResolver.formatValueForBlock(value, BlockType.FUNCTION, language)
  }

  private formatShellDisplayValue(value: unknown, template: string, matchIndex: number): string {
    const text = this.stringifyShellDisplayValue(value)
    const quoteContext = this.getShellQuoteContext(template, matchIndex)
    if (quoteContext === 'double') {
      return text.replace(/["\\$`]/g, '\\$&')
    }

    return `"${text.replace(/["\\$`]/g, '\\$&')}"`
  }

  private stringifyShellDisplayValue(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }
    return JSON.stringify(value)
  }

  private getCodeStringQuoteContext(
    template: string,
    index: number,
    language: string | undefined
  ): CodeStringQuoteContext {
    const isPython = language === 'python'
    const modes: CodeScanMode[] = [{ type: 'normal' }]
    let lastSignificantIndex = -1
    const openParenIsControlHead: boolean[] = []
    let identifierFollowsPropertyAccess = false
    const controlHeadParenCloses = new Set<number>()
    const regexCloseIndices = new Set<number>()

    for (let i = 0; i < index; i++) {
      const char = template[i]
      const next = template[i + 1]
      const mode = modes[modes.length - 1]

      if (mode.type === 'line-comment') {
        if (char === '\n') {
          modes.pop()
        }
        continue
      }

      if (mode.type === 'block-comment') {
        if (char === '*' && next === '/') {
          modes.pop()
          i++
        }
        continue
      }

      if (mode.type === 'regex') {
        if (char === '\\') {
          i++
          continue
        }
        // A regex literal cannot span a line, so an unterminated one means the `/` was
        // division after all; dropping the mode keeps the rest of the scan honest.
        if (char === '\n') {
          modes.pop()
          continue
        }
        if (char === '[') {
          mode.inCharacterClass = true
          continue
        }
        if (char === ']') {
          mode.inCharacterClass = false
          continue
        }
        if (char === '/' && !mode.inCharacterClass) {
          modes.pop()
          // The literal that just closed is a value, so the next `/` divides it.
          regexCloseIndices.add(i)
          lastSignificantIndex = i
        }
        continue
      }

      if (mode.type === 'single' || mode.type === 'double') {
        const quote = mode.type === 'single' ? "'" : '"'
        if (char === '\\') {
          i++
          continue
        }
        if (char === quote || char === '\n') {
          modes.pop()
        }
        continue
      }

      if (mode.type === 'triple-single' || mode.type === 'triple-double') {
        const quote = mode.type === 'triple-single' ? "'" : '"'
        if (char === '\\') {
          i++
          continue
        }
        if (char === quote && next === quote && template[i + 2] === quote) {
          modes.pop()
          i += 2
        }
        continue
      }

      if (mode.type === 'template') {
        if (char === '\\') {
          i++
          continue
        }
        if (char === '`') {
          modes.pop()
          continue
        }
        if (char === '$' && next === '{') {
          modes.push({ type: 'template-expression', depth: 1 })
          i++
        }
        continue
      }

      if (mode.type === 'template-expression') {
        if (!isPython && char === '/' && next === '/') {
          modes.push({ type: 'line-comment' })
          i++
          continue
        }
        if (!isPython && char === '/' && next === '*') {
          modes.push({ type: 'block-comment' })
          i++
          continue
        }
        const previousSignificantIndex = lastSignificantIndex
        if (!WHITESPACE_CHAR.test(char)) {
          lastSignificantIndex = i
        }
        if (this.isJavaScriptIdentifierChar(char)) {
          // An identifier continues only when the character right before it is part of the same
          // token. Asking the previous *significant* character instead treats a name after a
          // line break as a continuation and leaves it carrying the last one's answer.
          if (i === 0 || !this.isJavaScriptIdentifierChar(template[i - 1])) {
            identifierFollowsPropertyAccess = template[previousSignificantIndex] === '.'
          }
        } else if (char === '(') {
          openParenIsControlHead.push(
            this.opensControlFlowHead(
              template,
              previousSignificantIndex,
              identifierFollowsPropertyAccess
            )
          )
        } else if (char === ')') {
          if (openParenIsControlHead.pop()) controlHeadParenCloses.add(i)
        }
        if (
          !isPython &&
          char === '/' &&
          this.canStartJavaScriptRegex(template, previousSignificantIndex, {
            controlHeadParenCloses,
            regexCloseIndices,
          })
        ) {
          modes.push({ type: 'regex', inCharacterClass: false })
          continue
        }
        if (isPython && char === "'" && next === "'" && template[i + 2] === "'") {
          modes.push({ type: 'triple-single' })
          i += 2
          continue
        }
        if (isPython && char === '"' && next === '"' && template[i + 2] === '"') {
          modes.push({ type: 'triple-double' })
          i += 2
          continue
        }
        if (char === "'") {
          modes.push({ type: 'single' })
          continue
        }
        if (char === '"') {
          modes.push({ type: 'double' })
          continue
        }
        if (!isPython && char === '`') {
          modes.push({ type: 'template' })
          continue
        }
        if (char === '{') {
          mode.depth += 1
          continue
        }
        if (char === '}') {
          mode.depth -= 1
          if (mode.depth === 0) {
            modes.pop()
          }
        }
        continue
      }

      if (isPython && char === '#') {
        modes.push({ type: 'line-comment' })
        continue
      }
      if (!isPython && char === '/' && next === '/') {
        modes.push({ type: 'line-comment' })
        i++
        continue
      }
      if (!isPython && char === '/' && next === '*') {
        modes.push({ type: 'block-comment' })
        i++
        continue
      }
      const previousSignificantIndex = lastSignificantIndex
      if (!WHITESPACE_CHAR.test(char)) {
        lastSignificantIndex = i
      }
      if (this.isJavaScriptIdentifierChar(char)) {
        // An identifier continues only when the character right before it is part of the same
        // token. Asking the previous *significant* character instead treats a name after a
        // line break as a continuation and leaves it carrying the last one's answer.
        if (i === 0 || !this.isJavaScriptIdentifierChar(template[i - 1])) {
          identifierFollowsPropertyAccess = template[previousSignificantIndex] === '.'
        }
      } else if (char === '(') {
        openParenIsControlHead.push(
          this.opensControlFlowHead(
            template,
            previousSignificantIndex,
            identifierFollowsPropertyAccess
          )
        )
      } else if (char === ')') {
        if (openParenIsControlHead.pop()) controlHeadParenCloses.add(i)
      }
      if (
        !isPython &&
        char === '/' &&
        this.canStartJavaScriptRegex(template, previousSignificantIndex, {
          controlHeadParenCloses,
          regexCloseIndices,
        })
      ) {
        modes.push({ type: 'regex', inCharacterClass: false })
        continue
      }
      if (isPython && char === "'" && next === "'" && template[i + 2] === "'") {
        modes.push({ type: 'triple-single' })
        i += 2
      } else if (isPython && char === '"' && next === '"' && template[i + 2] === '"') {
        modes.push({ type: 'triple-double' })
        i += 2
      } else if (char === "'") {
        modes.push({ type: 'single' })
      } else if (char === '"') {
        modes.push({ type: 'double' })
      } else if (!isPython && char === '`') {
        modes.push({ type: 'template' })
      }
    }

    const mode = modes[modes.length - 1]
    if (mode.type === 'regex') {
      return 'regex'
    }
    if (
      mode.type === 'single' ||
      mode.type === 'double' ||
      mode.type === 'triple-single' ||
      mode.type === 'triple-double' ||
      mode.type === 'template'
    ) {
      return mode.type
    }
    return null
  }

  private formatShellContextVariableReference(
    varName: string,
    template: string,
    matchIndex: number,
    value: unknown
  ): string {
    const expansion = `\${${varName}}`
    const quoteContext = this.getShellQuoteContext(template, matchIndex)
    if (quoteContext === 'double') {
      return expansion
    }

    const shouldQuote =
      quoteContext === 'single' ||
      typeof value === 'string' ||
      (typeof value === 'object' && value !== null) ||
      Array.isArray(value)

    if (!shouldQuote) {
      return expansion
    }

    const quotedExpansion = `"${expansion}"`
    if (quoteContext === 'single') {
      return `'${quotedExpansion}'`
    }

    return quotedExpansion
  }

  private getShellQuoteContext(template: string, index: number): ShellQuoteContext {
    let quoteContext: ShellQuoteContext = null

    for (let i = 0; i < index; i++) {
      const char = template[i]

      if (quoteContext === null && this.isShellCommentStart(template, i)) {
        const nextNewline = template.indexOf('\n', i + 1)
        if (nextNewline === -1 || nextNewline >= index) {
          break
        }
        i = nextNewline
        continue
      }

      if (char === '\\' && quoteContext !== 'single') {
        i++
        continue
      }

      if (char === "'" && quoteContext !== 'double') {
        quoteContext = quoteContext === 'single' ? null : 'single'
      } else if (char === '"' && quoteContext !== 'single') {
        quoteContext = quoteContext === 'double' ? null : 'double'
      }
    }

    return quoteContext
  }

  private isShellCommentStart(template: string, index: number): boolean {
    if (template[index] !== '#') {
      return false
    }

    const previous = template[index - 1]
    return previous === undefined || /\s|[;&|()<>]/.test(previous)
  }

  private async resolveTemplate(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope,
    block?: SerializedBlock,
    options: { allowLargeValueRefs?: boolean; inputPath?: readonly string[] } = {}
  ): Promise<string> {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
      allowLargeValueRefs: options.allowLargeValueRefs,
      inputPath: options.inputPath,
    }

    let replacementError: Error | null = null

    const blockType = block?.metadata?.id
    const language =
      blockType === BlockType.FUNCTION
        ? ((block?.config?.params as Record<string, unknown> | undefined)?.language as
            | string
            | undefined)
        : undefined

    let projectedReferenceResult = ''
    let projectedReferenceCursor = 0
    let result = await replaceValidReferencesAsync(template, async (match, index) => {
      if (replacementError) return match

      projectedReferenceResult += template.slice(projectedReferenceCursor, index)
      projectedReferenceCursor = index + match.length
      let containsResolvedSecret = false
      const referenceContext: ResolutionContext = {
        ...resolutionContext,
        onResolvedSecretReference: () => {
          containsResolvedSecret = true
        },
      }

      try {
        const resolved = await this.resolveReference(match, referenceContext)
        if (resolved === undefined) {
          projectedReferenceResult += match
          return match
        }

        if (resolved === RESOLVED_EMPTY) {
          if (blockType === BlockType.FUNCTION) {
            const formatted = this.blockResolver.formatValueForBlock(null, blockType, language)
            projectedReferenceResult += formatted
            return formatted
          }
          projectedReferenceResult += ''
          return ''
        }

        const formatted = this.blockResolver.formatValueForBlock(resolved, blockType, language)
        projectedReferenceResult += containsResolvedSecret ? match : formatted
        return formatted
      } catch (error) {
        replacementError = toError(error)
        projectedReferenceResult += match
        return match
      }
    })
    projectedReferenceResult += template.slice(projectedReferenceCursor)

    if (replacementError !== null) {
      throw replacementError
    }

    result = await replaceEnvVarsAsync(result, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    ctx.resolvedSecretTraceRegistry?.recordResolvedInputProjection(
      options.inputPath,
      result,
      projectedReferenceResult
    )
    return result
  }

  private async resolveTemplateWithoutConditionFormatting(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope,
    inputPath?: readonly string[]
  ): Promise<string> {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
      inputPath,
    }

    let replacementError: Error | null = null

    let projectedReferenceResult = ''
    let projectedReferenceCursor = 0
    let result = await replaceValidReferencesAsync(template, async (match, index) => {
      if (replacementError) return match

      projectedReferenceResult += template.slice(projectedReferenceCursor, index)
      projectedReferenceCursor = index + match.length
      let containsResolvedSecret = false
      const referenceContext: ResolutionContext = {
        ...resolutionContext,
        onResolvedSecretReference: () => {
          containsResolvedSecret = true
        },
      }

      try {
        const resolved = await this.resolveReference(match, referenceContext)
        if (resolved === undefined) {
          projectedReferenceResult += match
          return match
        }

        if (resolved === RESOLVED_EMPTY) {
          projectedReferenceResult += 'null'
          return 'null'
        }

        if (typeof resolved === 'string') {
          const formatted = formatInertStringLiteral(resolved)
          projectedReferenceResult += containsResolvedSecret ? match : formatted
          return formatted
        }
        if (typeof resolved === 'object' && resolved !== null) {
          const formatted = this.formatConditionJson(resolved, template, index)
          projectedReferenceResult += containsResolvedSecret ? match : formatted
          return formatted
        }
        const formatted = String(resolved)
        projectedReferenceResult += containsResolvedSecret ? match : formatted
        return formatted
      } catch (error) {
        replacementError = toError(error)
        projectedReferenceResult += match
        return match
      }
    })
    projectedReferenceResult += template.slice(projectedReferenceCursor)

    if (replacementError !== null) {
      throw replacementError
    }

    result = await replaceEnvVarsAsync(result, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      if (typeof resolved !== 'string') return match
      return isStructurallyInertConditionLiteral(resolved) ? resolved : match
    })
    ctx.resolvedSecretTraceRegistry?.recordResolvedInputProjection(
      inputPath,
      result,
      projectedReferenceResult
    )
    return result
  }

  /**
   * Renders a resolved object for a Condition expression.
   *
   * Inside a quoted string the object is data, so its JSON is escaped to stay inside the
   * string the author opened: raw, the JSON's own structural quotes close that string, and
   * `"<start.body>" === "{}"` with a crafted key emits `"{"+attackerCode()+":1}"`, which
   * parses as concatenation and runs.
   *
   * Everywhere else the object is parsed at runtime rather than spliced as source. The value
   * is identical to the object literal it replaces, but the payload is a fully escaped
   * literal, so a crafted key can neither close a string nor forge a regex delimiter — which
   * matters because the emitted form must be safe even when the quote scanner reads the
   * surrounding context wrongly, and a quote inside a regex literal is enough to do that.
   * Splicing raw JSON would make that heuristic load-bearing for injection.
   */
  private formatConditionJson(value: object, template: string, matchIndex: number): string {
    const escaped = escapeInertStringContent(JSON.stringify(value))
    const quoteContext = this.getCodeStringQuoteContext(template, matchIndex, 'javascript')
    return quoteContext === null ? `JSON.parse('${escaped}')` : escaped
  }

  private async resolveReference(reference: string, context: ResolutionContext): Promise<any> {
    for (const resolver of this.resolvers) {
      if (resolver.canResolve(reference)) {
        const result = resolver.resolveAsync
          ? await resolver.resolveAsync(reference, context)
          : resolver.resolve(reference, context)
        return result
      }
    }

    logger.warn('No resolver found for reference', { reference })
    return undefined
  }
}
