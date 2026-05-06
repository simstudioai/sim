import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { BlockType } from '@/executor/constants'
import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { createEnvVarPattern, replaceValidReferences } from '@/executor/utils/reference-validation'
import { BlockResolver } from '@/executor/variables/resolvers/block'
import { EnvResolver } from '@/executor/variables/resolvers/env'
import { LoopResolver } from '@/executor/variables/resolvers/loop'
import { ParallelResolver } from '@/executor/variables/resolvers/parallel'
import {
  RESOLVED_EMPTY,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import { WorkflowResolver } from '@/executor/variables/resolvers/workflow'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/** Key used to carry pre-resolved context variables through the inputs map. */
export const FUNCTION_BLOCK_CONTEXT_VARS_KEY = '_runtimeContextVars'

const logger = createLogger('VariableResolver')

type ShellQuoteContext = 'single' | 'double' | null

export class VariableResolver {
  private resolvers: Resolver[]
  private blockResolver: BlockResolver

  constructor(
    workflow: SerializedWorkflow,
    workflowVariables: Record<string, any>,
    private state: ExecutionState
  ) {
    this.blockResolver = new BlockResolver(workflow)
    this.resolvers = [
      new LoopResolver(workflow),
      new ParallelResolver(workflow),
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
   * Returns the resolved inputs and a `contextVariables` map. Callers should inject
   * contextVariables into the function execution request body so the isolated VM can
   * access them as global variables.
   */
  resolveInputsForFunctionBlock(
    ctx: ExecutionContext,
    currentNodeId: string,
    params: Record<string, any> | null | undefined,
    block: SerializedBlock
  ): { resolvedInputs: Record<string, any>; contextVariables: Record<string, unknown> } {
    const contextVariables: Record<string, unknown> = {}
    const resolved: Record<string, any> = {}

    if (!params) {
      return { resolvedInputs: resolved, contextVariables }
    }

    for (const [key, value] of Object.entries(params)) {
      if (key === 'code') {
        if (typeof value === 'string') {
          resolved[key] = this.resolveCodeWithContextVars(
            ctx,
            currentNodeId,
            value,
            undefined,
            block,
            contextVariables
          )
        } else if (Array.isArray(value)) {
          resolved[key] = value.map((item: any) => {
            if (item && typeof item === 'object' && typeof item.content === 'string') {
              return {
                ...item,
                content: this.resolveCodeWithContextVars(
                  ctx,
                  currentNodeId,
                  item.content,
                  undefined,
                  block,
                  contextVariables
                ),
              }
            }
            return item
          })
        } else {
          resolved[key] = this.resolveValue(ctx, currentNodeId, value, undefined, block)
        }
      } else {
        resolved[key] = this.resolveValue(ctx, currentNodeId, value, undefined, block)
      }
    }

    return { resolvedInputs: resolved, contextVariables }
  }

  resolveInputs(
    ctx: ExecutionContext,
    currentNodeId: string,
    params: Record<string, any>,
    block?: SerializedBlock
  ): Record<string, any> {
    if (!params) {
      return {}
    }
    const resolved: Record<string, any> = {}

    const isConditionBlock = block?.metadata?.id === BlockType.CONDITION
    if (isConditionBlock && typeof params.conditions === 'string') {
      try {
        const parsed = JSON.parse(params.conditions)
        if (Array.isArray(parsed)) {
          resolved.conditions = parsed.map((cond: any) => ({
            ...cond,
            value:
              typeof cond.value === 'string'
                ? this.resolveTemplateWithoutConditionFormatting(ctx, currentNodeId, cond.value)
                : cond.value,
          }))
        } else {
          resolved.conditions = this.resolveValue(
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
        resolved.conditions = this.resolveValue(
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
      resolved[key] = this.resolveValue(ctx, currentNodeId, value, undefined, block)
    }
    return resolved
  }

  resolveSingleReference(
    ctx: ExecutionContext,
    currentNodeId: string,
    reference: string,
    loopScope?: LoopScope
  ): any {
    if (typeof reference === 'string') {
      const trimmed = reference.trim()
      if (/^<[^<>]+>$/.test(trimmed)) {
        const resolutionContext: ResolutionContext = {
          executionContext: ctx,
          executionState: this.state,
          currentNodeId,
          loopScope,
        }

        const result = this.resolveReference(trimmed, resolutionContext)
        if (result === RESOLVED_EMPTY) {
          return null
        }
        return result
      }
    }

    return this.resolveValue(ctx, currentNodeId, reference, loopScope)
  }

  private resolveValue(
    ctx: ExecutionContext,
    currentNodeId: string,
    value: any,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): any {
    if (value === null || value === undefined) {
      return value
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.resolveValue(ctx, currentNodeId, v, loopScope, block))
    }

    if (typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: this.resolveValue(ctx, currentNodeId, val, loopScope, block),
        }),
        {}
      )
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
  private resolveCodeWithContextVars(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope: LoopScope | undefined,
    block: SerializedBlock,
    contextVarAccumulator: Record<string, unknown>
  ): string {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }

    const language = (block.config?.params as Record<string, unknown> | undefined)?.language as
      | string
      | undefined

    let replacementError: Error | null = null

    let result = replaceValidReferences(template, (match, index) => {
      if (replacementError) return match

      try {
        if (this.blockResolver.canResolve(match)) {
          const resolved = this.resolveReference(match, resolutionContext)
          if (resolved === undefined) return match

          const effectiveValue = resolved === RESOLVED_EMPTY ? null : resolved

          // Block output: store in contextVarAccumulator and replace the reference
          // with language-specific runtime access to that stored value.
          const varName = `__blockRef_${Object.keys(contextVarAccumulator).length}`
          contextVarAccumulator[varName] = effectiveValue
          const replacement = this.formatContextVariableReference(
            varName,
            language,
            template,
            index,
            effectiveValue
          )
          return replacement
        }

        const resolved = this.resolveReference(match, resolutionContext)
        if (resolved === undefined) return match

        const effectiveValue = resolved === RESOLVED_EMPTY ? null : resolved

        // Non-block reference (loop, parallel, workflow, env): embed as literal
        return this.blockResolver.formatValueForBlock(effectiveValue, BlockType.FUNCTION, language)
      } catch (error) {
        replacementError = error instanceof Error ? error : new Error(String(error))
        return match
      }
    })

    if (replacementError !== null) {
      throw replacementError
    }

    result = result.replace(createEnvVarPattern(), (match) => {
      const resolved = this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })

    return result
  }

  private formatContextVariableReference(
    varName: string,
    language: string | undefined,
    template: string,
    matchIndex: number,
    value: unknown
  ): string {
    if (language === 'python') {
      return `globals()[${JSON.stringify(varName)}]`
    }

    if (language === 'shell') {
      return this.formatShellContextVariableReference(varName, template, matchIndex, value)
    }

    return `globalThis[${JSON.stringify(varName)}]`
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

  private resolveTemplate(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): string {
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

    let result = replaceValidReferences(template, (match) => {
      if (replacementError) return match

      try {
        const resolved = this.resolveReference(match, resolutionContext)
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

    result = result.replace(createEnvVarPattern(), (match) => {
      const resolved = this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    return result
  }

  private resolveTemplateWithoutConditionFormatting(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope
  ): string {
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }

    let replacementError: Error | null = null

    let result = replaceValidReferences(template, (match) => {
      if (replacementError) return match

      try {
        const resolved = this.resolveReference(match, resolutionContext)
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

    result = result.replace(createEnvVarPattern(), (match) => {
      const resolved = this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })
    return result
  }

  private resolveReference(reference: string, context: ResolutionContext): any {
    for (const resolver of this.resolvers) {
      if (resolver.canResolve(reference)) {
        const result = resolver.resolve(reference, context)
        return result
      }
    }

    logger.warn('No resolver found for reference', { reference })
    return undefined
  }
}
