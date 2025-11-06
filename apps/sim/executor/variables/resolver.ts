import { createLogger } from '@/lib/logs/console/logger'
import { BlockType, REFERENCE } from '@/executor/consts'
import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { BlockResolver } from '@/executor/variables/resolvers/block'
import { EnvResolver } from '@/executor/variables/resolvers/env'
import { LoopResolver } from '@/executor/variables/resolvers/loop'
import { ParallelResolver } from '@/executor/variables/resolvers/parallel'
import type { ResolutionContext, Resolver } from '@/executor/variables/resolvers/reference'
import { WorkflowResolver } from '@/executor/variables/resolvers/workflow'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('VariableResolver')

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

        return this.resolveReference(trimmed, resolutionContext)
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
  private resolveTemplate(
    ctx: ExecutionContext,
    currentNodeId: string,
    template: string,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): string {
    let result = template
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }
    const referenceRegex = new RegExp(
      `${REFERENCE.START}([^${REFERENCE.END}]+)${REFERENCE.END}`,
      'g'
    )

    let replacementError: Error | null = null

    result = result.replace(referenceRegex, (match) => {
      if (replacementError) return match

      try {
        const resolved = this.resolveReference(match, resolutionContext)
        if (resolved === undefined) {
          return match
        }

        const blockType = block?.metadata?.id
        const isInTemplateLiteral =
          blockType === BlockType.FUNCTION &&
          template.includes('${') &&
          template.includes('}') &&
          template.includes('`')

        return this.blockResolver.formatValueForBlock(resolved, blockType, isInTemplateLiteral)
      } catch (error) {
        replacementError = error instanceof Error ? error : new Error(String(error))
        return match
      }
    })

    if (replacementError !== null) {
      throw replacementError
    }

    const envRegex = new RegExp(`${REFERENCE.ENV_VAR_START}([^}]+)${REFERENCE.ENV_VAR_END}`, 'g')
    result = result.replace(envRegex, (match) => {
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
    let result = template
    const resolutionContext: ResolutionContext = {
      executionContext: ctx,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }
    const referenceRegex = new RegExp(
      `${REFERENCE.START}([^${REFERENCE.END}]+)${REFERENCE.END}`,
      'g'
    )

    let replacementError: Error | null = null

    result = result.replace(referenceRegex, (match) => {
      if (replacementError) return match

      try {
        const resolved = this.resolveReference(match, resolutionContext)
        if (resolved === undefined) {
          return match
        }

        if (typeof resolved === 'string') {
          const escaped = resolved.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
          return `'${escaped}'`
        }
        if (typeof resolved === 'object' && resolved !== null) {
          return JSON.stringify(resolved)
        }
        return String(resolved)
      } catch (error) {
        replacementError = error instanceof Error ? error : new Error(String(error))
        return match
      }
    })

    if (replacementError !== null) {
      throw replacementError
    }

    const envRegex = new RegExp(`${REFERENCE.ENV_VAR_START}([^}]+)${REFERENCE.ENV_VAR_END}`, 'g')
    result = result.replace(envRegex, (match) => {
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
