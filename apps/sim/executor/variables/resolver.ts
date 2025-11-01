import { createLogger } from '@/lib/logs/console/logger'
import { BlockType, REFERENCE } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { ExecutionState, LoopScope } from '../execution/state'
import { BlockResolver } from './resolvers/block'
import { EnvResolver } from './resolvers/env'
import { LoopResolver } from './resolvers/loop'
import { ParallelResolver } from './resolvers/parallel'
import type { ResolutionContext, Resolver } from './resolvers/reference'
import { WorkflowResolver } from './resolvers/workflow'

const logger = createLogger('VariableResolver')

const INVALID_REFERENCE_CHARS = /[+*/=<>!]/

function isLikelyReferenceSegment(segment: string): boolean {
  if (!segment.startsWith(REFERENCE.START) || !segment.endsWith(REFERENCE.END)) {
    return false
  }

  const inner = segment.slice(1, -1)

  // Starts with space - not a reference
  if (inner.startsWith(' ')) {
    return false
  }

  // Contains only comparison operators or has operators with spaces
  if (inner.match(/^\s*[<>=!]+\s*$/) || inner.match(/\s[<>=!]+\s/)) {
    return false
  }

  // Starts with comparison operator followed by space
  if (inner.match(/^[<>=!]+\s/)) {
    return false
  }

  // For dotted references (like <block.field>)
  if (inner.includes('.')) {
    const dotIndex = inner.indexOf('.')
    const beforeDot = inner.substring(0, dotIndex)
    const afterDot = inner.substring(dotIndex + 1)

    // No spaces after dot
    if (afterDot.includes(' ')) {
      return false
    }

    // No invalid chars in either part
    if (INVALID_REFERENCE_CHARS.test(beforeDot) || INVALID_REFERENCE_CHARS.test(afterDot)) {
      return false
    }
  } else if (INVALID_REFERENCE_CHARS.test(inner) || inner.match(/^\d/) || inner.match(/\s\d/)) {
    // No invalid chars, doesn't start with digit, no space before digit
    return false
  }

  return true
}

export class VariableResolver {
  private resolvers: Resolver[]
  private blockResolver: BlockResolver

  constructor(
    private workflow: SerializedWorkflow,
    private workflowVariables: Record<string, any>,
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
    for (const [key, value] of Object.entries(params)) {
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
      
      if (!isLikelyReferenceSegment(match)) {
        return match
      }
      
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

  private resolveReference(reference: string, context: ResolutionContext): any {
    for (const resolver of this.resolvers) {
      if (resolver.canResolve(reference)) {
        const result = resolver.resolve(reference, context)
        logger.debug('Reference resolved', {
          reference,
          resolver: resolver.constructor.name,
          result,
        })
        return result
      }
    }

    logger.warn('No resolver found for reference', { reference })
    return undefined
  }
}
