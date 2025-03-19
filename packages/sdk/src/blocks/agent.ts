import { Block } from './base'
import { Tool } from '../tools'

export interface AgentOptions {
  model: string
  prompt: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  tools?: AgentTool[]
  apiKey: string
}

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, any>
}

/**
 * Agent block for LLM-powered operations
 */
export class AgentBlock extends Block {
  // Define required parameters for agent blocks
  static requiredParameters: string[] = ['model', 'prompt']

  constructor(options: AgentOptions) {
    super('agent', options)
    this.metadata.id = 'agent'
  }

  /**
   * Set the model to use for this agent
   */
  setModel(model: string): this {
    this.data.model = model
    return this
  }

  /**
   * Set the prompt for this agent
   */
  setPrompt(prompt: string): this {
    this.data.prompt = prompt
    return this
  }

  /**
   * Set the system prompt for this agent
   */
  setSystemPrompt(systemPrompt: string): this {
    this.data.systemPrompt = systemPrompt
    return this
  }

  /**
   * Set the temperature for response generation
   */
  setTemperature(temperature: number): this {
    this.data.temperature = temperature
    return this
  }

  /**
   * Set the maximum token count for response
   */
  setMaxTokens(maxTokens: number): this {
    this.data.maxTokens = maxTokens
    return this
  }

  /**
   * Add a tool for the agent to use
   */
  addTool(tool: Tool | AgentTool): this {
    if (!this.data.tools) {
      this.data.tools = []
    }
    
    // Convert Tool to AgentTool if needed
    const agentTool: AgentTool = 'parameters' in tool 
      ? { name: tool.name, description: tool.description, parameters: tool.parameters }
      : { name: tool.id, description: tool.description, parameters: tool.schema }
    
    this.data.tools.push(agentTool)
    return this
  }
} 