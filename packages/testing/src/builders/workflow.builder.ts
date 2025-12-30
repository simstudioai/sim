import {
  createAgentBlock,
  createBlock,
  createFunctionBlock,
  createStarterBlock,
} from '../factories/block.factory'
import type { Position } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fluent builder for creating complex workflow states.
 *
 * Use this when you need fine-grained control over workflow construction,
 * especially for testing edge cases or complex scenarios.
 *
 * @example
 * ```ts
 * // Simple linear workflow
 * const workflow = new WorkflowBuilder()
 *   .addStarter('start')
 *   .addAgent('agent', { x: 200, y: 0 })
 *   .addFunction('end', { x: 400, y: 0 })
 *   .connect('start', 'agent')
 *   .connect('agent', 'end')
 *   .build()
 *
 * // Using static presets
 * const workflow = WorkflowBuilder.linear(5).build()
 * const workflow = WorkflowBuilder.branching().build()
 * ```
 */
export class WorkflowBuilder {
  private blocks: Record<string, any> = {}
  private edges: any[] = []
  private loops: Record<string, any> = {}
  private parallels: Record<string, any> = {}
  private variables: any[] = []
  private isDeployed = false

  /**
   * Adds a generic block to the workflow.
   */
  addBlock(id: string, type: string, position?: Position, name?: string): this {
    this.blocks[id] = createBlock({
      id,
      type,
      name: name ?? id,
      position: position ?? { x: 0, y: 0 },
    })
    return this
  }

  /**
   * Adds a starter block (workflow entry point).
   */
  addStarter(id = 'start', position?: Position): this {
    this.blocks[id] = createStarterBlock({
      id,
      position: position ?? { x: 0, y: 0 },
    })
    return this
  }

  /**
   * Adds a function block.
   */
  addFunction(id: string, position?: Position, name?: string): this {
    this.blocks[id] = createFunctionBlock({
      id,
      name: name ?? id,
      position: position ?? { x: 0, y: 0 },
    })
    return this
  }

  /**
   * Adds an agent block.
   */
  addAgent(id: string, position?: Position, name?: string): this {
    this.blocks[id] = createAgentBlock({
      id,
      name: name ?? id,
      position: position ?? { x: 0, y: 0 },
    })
    return this
  }

  /**
   * Adds a condition block.
   */
  addCondition(id: string, position?: Position, name?: string): this {
    this.blocks[id] = createBlock({
      id,
      type: 'condition',
      name: name ?? id,
      position: position ?? { x: 0, y: 0 },
    })
    return this
  }

  /**
   * Adds a loop container block.
   */
  addLoop(
    id: string,
    position?: Position,
    config?: {
      iterations?: number
      loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
    }
  ): this {
    this.blocks[id] = createBlock({
      id,
      type: 'loop',
      name: 'Loop',
      position: position ?? { x: 0, y: 0 },
      data: {
        loopType: config?.loopType ?? 'for',
        count: config?.iterations ?? 3,
        type: 'loop',
      },
    })
    this.loops[id] = {
      id,
      nodes: [],
      iterations: config?.iterations ?? 3,
      loopType: config?.loopType ?? 'for',
    }
    return this
  }

  /**
   * Adds a block as a child of a loop container.
   */
  addLoopChild(loopId: string, childId: string, type = 'function', position?: Position): this {
    if (!this.loops[loopId]) {
      throw new Error(`Loop ${loopId} does not exist. Call addLoop first.`)
    }

    this.blocks[childId] = createBlock({
      id: childId,
      type,
      name: childId,
      position: position ?? { x: 50, y: 50 },
      parentId: loopId,
    })

    this.loops[loopId].nodes.push(childId)
    return this
  }

  /**
   * Adds a parallel container block.
   */
  addParallel(
    id: string,
    position?: Position,
    config?: {
      count?: number
      parallelType?: 'count' | 'collection'
    }
  ): this {
    this.blocks[id] = createBlock({
      id,
      type: 'parallel',
      name: 'Parallel',
      position: position ?? { x: 0, y: 0 },
      data: {
        parallelType: config?.parallelType ?? 'count',
        count: config?.count ?? 2,
        type: 'parallel',
      },
    })
    this.parallels[id] = {
      id,
      nodes: [],
      count: config?.count ?? 2,
      parallelType: config?.parallelType ?? 'count',
    }
    return this
  }

  /**
   * Adds a block as a child of a parallel container.
   */
  addParallelChild(
    parallelId: string,
    childId: string,
    type = 'function',
    position?: Position
  ): this {
    if (!this.parallels[parallelId]) {
      throw new Error(`Parallel ${parallelId} does not exist. Call addParallel first.`)
    }

    this.blocks[childId] = createBlock({
      id: childId,
      type,
      name: childId,
      position: position ?? { x: 50, y: 50 },
      parentId: parallelId,
    })

    this.parallels[parallelId].nodes.push(childId)
    return this
  }

  /**
   * Creates an edge connecting two blocks.
   */
  connect(sourceId: string, targetId: string, sourceHandle?: string, targetHandle?: string): this {
    this.edges.push({
      id: `${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle,
    })
    return this
  }

  /**
   * Adds a workflow variable.
   */
  addVariable(
    name: string,
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain',
    value: any
  ): this {
    this.variables?.push({
      id: `var-${Math.random().toString(36).substring(2, 8)}`,
      name,
      type,
      value,
    })
    return this
  }

  /**
   * Sets the workflow as deployed.
   */
  setDeployed(deployed = true): this {
    this.isDeployed = deployed
    return this
  }

  /**
   * Builds and returns the workflow state.
   * Returns `any` to be assignable to any app's workflow type.
   */
  build(): any {
    return {
      blocks: this.blocks,
      edges: this.edges,
      loops: this.loops,
      parallels: this.parallels,
      lastSaved: Date.now(),
      isDeployed: this.isDeployed,
      variables: this.variables?.length ? this.variables : undefined,
    }
  }

  /**
   * Creates a workflow with the specified blocks and connects them linearly.
   */
  static chain(...blockConfigs: Array<{ id: string; type: string }>): WorkflowBuilder {
    const builder = new WorkflowBuilder()
    let x = 0
    const spacing = 200

    blockConfigs.forEach((config, index) => {
      builder.addBlock(config.id, config.type, { x, y: 0 })
      x += spacing

      if (index > 0) {
        builder.connect(blockConfigs[index - 1].id, config.id)
      }
    })

    return builder
  }

  /**
   * Creates a linear workflow with N blocks.
   * First block is a starter, rest are function blocks.
   */
  static linear(blockCount: number): WorkflowBuilder {
    const builder = new WorkflowBuilder()
    const spacing = 200

    for (let i = 0; i < blockCount; i++) {
      const id = `block-${i}`
      const position = { x: i * spacing, y: 0 }

      if (i === 0) {
        builder.addStarter(id, position)
      } else {
        builder.addFunction(id, position, `Step ${i}`)
      }

      if (i > 0) {
        builder.connect(`block-${i - 1}`, id)
      }
    }

    return builder
  }

  /**
   * Creates a branching workflow with a condition.
   *
   * Structure:
   * ```
   *           ┌─→ true ─┐
   * start ─→ cond       ├─→ end
   *           └─→ false ┘
   * ```
   */
  static branching(): WorkflowBuilder {
    return new WorkflowBuilder()
      .addStarter('start', { x: 0, y: 0 })
      .addCondition('condition', { x: 200, y: 0 })
      .addFunction('true-branch', { x: 400, y: -100 }, 'If True')
      .addFunction('false-branch', { x: 400, y: 100 }, 'If False')
      .addFunction('end', { x: 600, y: 0 }, 'End')
      .connect('start', 'condition')
      .connect('condition', 'true-branch', 'condition-if')
      .connect('condition', 'false-branch', 'condition-else')
      .connect('true-branch', 'end')
      .connect('false-branch', 'end')
  }

  /**
   * Creates a workflow with a loop.
   */
  static withLoop(iterations = 3): WorkflowBuilder {
    return new WorkflowBuilder()
      .addStarter('start', { x: 0, y: 0 })
      .addLoop('loop', { x: 200, y: 0 }, { iterations })
      .addLoopChild('loop', 'loop-body', 'function', { x: 50, y: 50 })
      .addFunction('end', { x: 500, y: 0 })
      .connect('start', 'loop')
      .connect('loop', 'end')
  }

  /**
   * Creates a workflow with parallel execution.
   */
  static withParallel(count = 2): WorkflowBuilder {
    return new WorkflowBuilder()
      .addStarter('start', { x: 0, y: 0 })
      .addParallel('parallel', { x: 200, y: 0 }, { count })
      .addParallelChild('parallel', 'parallel-task', 'function', { x: 50, y: 50 })
      .addFunction('end', { x: 500, y: 0 })
      .connect('start', 'parallel')
      .connect('parallel', 'end')
  }
}
