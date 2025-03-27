import { Workflow, Connection, Loop, Block as BlockType } from '../types'
import { Block } from '../blocks/base'
import { StarterBlock } from '../blocks/starter'

/**
 * Builder class for creating workflows programmatically
 */
export class WorkflowBuilder {
  private workflow: Workflow
  private blockMap: Map<string, Block>

  /**
   * Create a new workflow builder
   */
  constructor(name: string, description?: string) {
    this.workflow = {
      name,
      description,
      blocks: [],
      connections: [],
      loops: {},
    }
    this.blockMap = new Map()

    // Add a starter block by default
    const starterBlock = new StarterBlock()
    this.addBlock(starterBlock)
  }

  /**
   * Add a block to the workflow
   */
  addBlock(block: Block): this {
    this.blockMap.set(block.id, block)
    this.workflow.blocks.push(block.toJSON())
    return this
  }

  /**
   * Connect two blocks
   */
  connect(sourceId: string, targetId: string, options: { 
    sourceHandle?: string
    targetHandle?: string
  } = {}): this {
    const connection: Connection = {
      source: sourceId,
      target: targetId,
      ...options,
    }
    this.workflow.connections.push(connection)
    return this
  }

  /**
   * Create a loop with specific blocks
   */
  createLoop(nodes: string[], iterations: number, iterationVariable?: string): this {
    const loopId = `loop_${Date.now()}`
    const loop: Loop = {
      nodes,
      iterations,
      ...(iterationVariable ? { iterationVariable } : {})
    }
    this.workflow.loops = {
      ...this.workflow.loops,
      [loopId]: loop
    }
    return this
  }

  /**
   * Position a block at specific coordinates
   */
  positionBlock(blockId: string, x: number, y: number): this {
    const block = this.workflow.blocks.find(b => b.id === blockId)
    if (block) {
      block.position = { x, y }
    }
    return this
  }

  /**
   * Get the workflow definition
   */
  build(): Workflow {
    return this.workflow
  }

  /**
   * Find a block by name
   */
  findBlockByName(name: string): BlockType | undefined {
    return this.workflow.blocks.find(block => block.metadata?.name === name)
  }

  /**
   * Get the starter block
   */
  getStarterBlock(): BlockType {
    const starterBlock = this.workflow.blocks.find(block => block.metadata?.id === 'starter')
    if (!starterBlock) {
      throw new Error('Starter block not found in workflow')
    }
    return starterBlock
  }
} 