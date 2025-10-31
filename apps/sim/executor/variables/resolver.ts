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
export class VariableResolver {
  private resolvers: Resolver[]
  constructor(
    private workflow: SerializedWorkflow,
    private workflowVariables: Record<string, any>,
    private state: ExecutionState
  ) {
    this.resolvers = [
      new LoopResolver(workflow),
      new ParallelResolver(workflow),
      new WorkflowResolver(workflowVariables),
      new EnvResolver(),
      new BlockResolver(workflow),
    ]
  }
  resolveInputs(
    params: Record<string, any>,
    currentNodeId: string,
    context: ExecutionContext,
    block?: SerializedBlock
  ): Record<string, any> {
    if (!params) {
      return {}
    }
    const resolved: Record<string, any> = {}
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, undefined, block)
    }
    return resolved
  }
  resolveSingleReference(
    reference: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope
  ): any {
    return this.resolveValue(reference, currentNodeId, context, loopScope)
  }
  private resolveValue(
    value: any,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): any {
    if (value === null || value === undefined) {
      return value
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveValue(v, currentNodeId, context, loopScope, block))
    }
    if (typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: this.resolveValue(val, currentNodeId, context, loopScope, block),
        }),
        {}
      )
    }
    if (typeof value === 'string') {
      return this.resolveTemplate(value, currentNodeId, context, loopScope, block)
    }
    return value
  }
  private resolveTemplate(
    template: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): string {
    let result = template
    const resolutionContext: ResolutionContext = {
      executionContext: context,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }
    const referenceRegex = new RegExp(
      `${REFERENCE.START}([^${REFERENCE.END}]+)${REFERENCE.END}`,
      'g'
    )
    result = result.replace(referenceRegex, (match) => {
      const resolved = this.resolveReference(match, resolutionContext)
      if (resolved === undefined) {
        return match
      }
      const isFunctionBlock = block?.metadata?.id === BlockType.FUNCTION
      if (typeof resolved === 'string') {
        if (isFunctionBlock) {
          return JSON.stringify(resolved)
        }
        return resolved
      }
      if (typeof resolved === 'number' || typeof resolved === 'boolean') {
        return String(resolved)
      }
      return JSON.stringify(resolved)
    })
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
