import { Block } from './base'

export interface Condition {
  id: string
  expression: string
  description?: string
}

export interface ConditionOptions {
  conditions: Condition[]
}

/**
 * Condition block for branching workflows based on logical expressions
 */
export class ConditionBlock extends Block {
  constructor(options: ConditionOptions) {
    super('condition', options)
    this.metadata.id = 'condition'
  }

  /**
   * Add a condition branch
   */
  addCondition(condition: Condition): this {
    if (!this.data.conditions) {
      this.data.conditions = []
    }
    this.data.conditions.push(condition)
    return this
  }

  /**
   * Remove a condition by ID
   */
  removeCondition(conditionId: string): this {
    if (this.data.conditions) {
      this.data.conditions = this.data.conditions.filter(
        (c: Condition) => c.id !== conditionId
      )
    }
    return this
  }

  /**
   * Set all conditions at once
   */
  setConditions(conditions: Condition[]): this {
    this.data.conditions = conditions
    return this
  }
} 