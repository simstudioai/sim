import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  containsLargeValueRef,
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { isLikelyReferenceSegment } from '@/lib/workflows/sanitization/references'
import { BlockType, parseReferencePath, REFERENCE } from '@/executor/constants'
import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
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

/** Key used to carry pre-resolved context variables through the inputs map. */
export const FUNCTION_BLOCK_CONTEXT_VARS_KEY = '_runtimeContextVars'
/** Key used to carry display-resolved code through the function execution path. */
export const FUNCTION_BLOCK_DISPLAY_CODE_KEY = '_runtimeDisplayCode'

const logger = createLogger('VariableResolver')

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

type ShellQuoteContext = 'single' | 'double' | null
type CodeStringQuoteContext = ShellQuoteContext | 'triple-single' | 'triple-double' | 'template'
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
      new WorkflowResolver(workflowVariables),
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
   * isolated VM can access them as global variables.
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
            contextVariables
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
                contextVariables
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
          resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block)
          display[key] = resolved[key]
        }
      } else {
        resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block)
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
    if (isConditionBlock && typeof params.conditions === 'string') {
      try {
        const parsed = JSON.parse(params.conditions)
        if (Array.isArray(parsed)) {
          resolved.conditions = await Promise.all(
            parsed.map(async (cond: any) => ({
              ...cond,
              value:
                typeof cond.value === 'string'
                  ? await this.resolveTemplateWithoutConditionFormatting(
                      ctx,
                      currentNodeId,
                      cond.value
                    )
                  : cond.value,
            }))
          )
        } else {
          resolved.conditions = await this.resolveValue(
            ctx,
            currentNodeId,
            params.conditions,
            undefined,
            block
          )
        }
      } catch (parseError) {
        logger.warn('Failed to parse conditions JSON, falling back to normal resolution', {
          error: parseError,
          conditions: params.conditions,
        })
        resolved.conditions = await this.resolveValue(
          ctx,
          currentNodeId,
          params.conditions,
          undefined,
          block
        )
      }
    }

    for (const [key, value] of Object.entries(params)) {
      if (isConditionBlock && key === 'conditions') {
        continue
      }
      resolved[key] = await this.resolveValue(ctx, currentNodeId, value, undefined, block)
    }
    return resolved
  }

  async resolveSingleReference(
    ctx: ExecutionContext,
    currentNodeId: string,
    reference: string,
    loopScope?: LoopScope
  ): Promise<any> {
    if (typeof reference === 'string') {
      const trimmed = reference.trim()
      if (/^<[^<>]+>$/.test(trimmed)) {
        const resolutionContext: ResolutionContext = {
          executionContext: ctx,
          executionState: this.state,
          currentNodeId,
          loopScope,
        }

        const result = await this.resolveReference(trimmed, resolutionContext)
        if (result === RESOLVED_EMPTY) {
          return null
        }
        return result
      }
    }

    return this.resolveValue(ctx, currentNodeId, reference, loopScope)
  }

  private async resolveValue(
    ctx: ExecutionContext,
    currentNodeId: string,
    value: any,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): Promise<any> {
    if (value === null || value === undefined) {
      return value
    }

    if (Array.isArray(value)) {
      return Promise.all(
        value.map((v) => this.resolveValue(ctx, currentNodeId, v, loopScope, block))
      )
    }

    if (typeof value === 'object') {
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, val]) => [
          key,
          await this.resolveValue(ctx, currentNodeId, val, loopScope, block),
        ])
      )
      return Object.fromEntries(entries)
    }

    if (typeof value === 'string') {
      return this.resolveTemplate(ctx, currentNodeId, value, loopScope, block)
    }
    return value
  }
  /**
   * Resolves a code template for a function block. Block output references are stored
   * in `contextVarAccumulator` as named variables (e.g. `__blockRef_0`) and replaced
   * with those variable names in the returned code string. Non-block references (loop
   * items, workflow variables, env vars) are still inlined as literals so they remain
   * available without any extra passing mechanism.
   */
  private async resolveCodeWithContextVars(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope: LoopScope | undefined,
    block: SerializedBlock,
    contextVarAccumulator: Record<string, unknown>
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

    let result = await replaceValidReferencesAsync(template, async (match, index) => {
      if (replacementError) return match
      displayResult += template.slice(displayCursor, index)
      displayCursor = index + match.length

      try {
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
          contextVarAccumulator[varName] = effectiveValue
          let replacement: string
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
          } else if (containsLargeValueRef(effectiveValue)) {
            throw getNestedLargeValueMaterializationError()
          } else {
            replacement = this.formatContextVariableReference(
              varName,
              language,
              template,
              index,
              effectiveValue
            )
          }
          displayResult += this.formatDisplayValueForCodeContext(
            effectiveValue,
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

        if (containsLargeValueRef(effectiveValue)) {
          throw getNestedLargeValueMaterializationError()
        }

        // Non-block reference (loop, parallel, workflow, env): embed as literal
        const replacement = this.blockResolver.formatValueForBlock(
          effectiveValue,
          BlockType.FUNCTION,
          language
        )
        displayResult += replacement
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

    result = await replaceEnvVarsAsync(result, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    displayResult = await replaceEnvVarsAsync(displayResult, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })

    return { resolvedCode: result, displayCode: displayResult }
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
    block?: SerializedBlock
  ): Promise<string> {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }

    let replacementError: Error | null = null

    const blockType = block?.metadata?.id
    const language =
      blockType === BlockType.FUNCTION
        ? ((block?.config?.params as Record<string, unknown> | undefined)?.language as
            | string
            | undefined)
        : undefined

    let result = await replaceValidReferencesAsync(template, async (match) => {
      if (replacementError) return match

      try {
        const resolved = await this.resolveReference(match, resolutionContext)
        if (resolved === undefined) {
          return match
        }

        if (resolved === RESOLVED_EMPTY) {
          if (blockType === BlockType.FUNCTION) {
            return this.blockResolver.formatValueForBlock(null, blockType, language)
          }
          return ''
        }

        return this.blockResolver.formatValueForBlock(resolved, blockType, language)
      } catch (error) {
        replacementError = toError(error)
        return match
      }
    })

    if (replacementError !== null) {
      throw replacementError
    }

    result = await replaceEnvVarsAsync(result, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    return result
  }

  private async resolveTemplateWithoutConditionFormatting(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope
  ): Promise<string> {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }

    let replacementError: Error | null = null

    let result = await replaceValidReferencesAsync(template, async (match) => {
      if (replacementError) return match

      try {
        const resolved = await this.resolveReference(match, resolutionContext)
        if (resolved === undefined) {
          return match
        }

        if (resolved === RESOLVED_EMPTY) {
          return 'null'
        }

        if (typeof resolved === 'string') {
          const escaped = resolved
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029')
          return `'${escaped}'`
        }
        if (typeof resolved === 'object' && resolved !== null) {
          return JSON.stringify(resolved)
        }
        return String(resolved)
      } catch (error) {
        replacementError = toError(error)
        return match
      }
    })

    if (replacementError !== null) {
      throw replacementError
    }

    result = await replaceEnvVarsAsync(result, async (match) => {
      const resolved = await this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    return result
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
