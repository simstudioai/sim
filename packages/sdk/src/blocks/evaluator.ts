import { Block } from './base'

export interface EvaluatorOptions {
  criteria: Criterion[]
  model?: string
  systemPrompt?: string
}

export interface Criterion {
  id: string
  name: string
  description: string
  weight?: number
}

/**
 * Evaluator block for assessing outputs using LLM-based evaluation
 */
export class EvaluatorBlock extends Block {
  constructor(options: EvaluatorOptions) {
    super('evaluator', options)
    this.metadata.id = 'evaluator'
  }

  /**
   * Set the evaluation criteria
   */
  setCriteria(criteria: Criterion[]): this {
    this.data.criteria = criteria
    return this
  }

  /**
   * Add an evaluation criterion
   */
  addCriterion(criterion: Criterion): this {
    if (!this.data.criteria) {
      this.data.criteria = []
    }
    this.data.criteria.push(criterion)
    return this
  }

  /**
   * Remove a criterion by ID
   */
  removeCriterion(criterionId: string): this {
    if (this.data.criteria) {
      this.data.criteria = this.data.criteria.filter(
        (c: Criterion) => c.id !== criterionId
      )
    }
    return this
  }

  /**
   * Set the model to use for evaluation
   */
  setModel(model: string): this {
    this.data.model = model
    return this
  }

  /**
   * Set the system prompt for evaluation
   */
  setSystemPrompt(systemPrompt: string): this {
    this.data.systemPrompt = systemPrompt
    return this
  }
} 