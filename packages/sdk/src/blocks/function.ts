import { Block } from './base'

export interface FunctionOptions {
  code: string
  timeout?: number
  environment?: Record<string, string>
}

/**
 * Function block for custom JavaScript code execution
 */
export class FunctionBlock extends Block {
  constructor(options: FunctionOptions) {
    super('function', options)
    this.metadata.id = 'function'
  }

  /**
   * Set the JavaScript code to execute
   */
  setCode(code: string): this {
    this.data.code = code
    return this
  }

  /**
   * Set the execution timeout in milliseconds
   */
  setTimeout(timeout: number): this {
    this.data.timeout = timeout
    return this
  }

  /**
   * Set environment variables for function execution
   */
  setEnvironment(env: Record<string, string>): this {
    this.data.environment = env
    return this
  }
} 