import { Block } from './base'

export interface StarterOptions {
  input?: Record<string, any>
}

/**
 * Starter block for workflow entry point
 */
export class StarterBlock extends Block {
  constructor(options: StarterOptions = {}) {
    super('starter', options)
    this.metadata.id = 'starter'
    this.setName('Start')
  }

  /**
   * Set the default input for this workflow
   */
  setInput(input: Record<string, any>): this {
    this.data.input = input
    return this
  }
} 