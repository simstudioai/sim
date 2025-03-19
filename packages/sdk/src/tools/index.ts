/**
 * Tool registry for Sim Studio SDK
 */
import { availableTools } from '../generated/index'

export interface Tool {
  id: string
  name: string
  description: string
  schema: any
  parameters?: any
  requiredParameters?: string[] // Parameters that must be provided for the tool to function
  execute(params: any): Promise<any>
}

/**
 * Registry for all available tool types
 */
export class ToolRegistry {
  private static tools: Map<string, Tool> = new Map()

  /**
   * Register a tool
   */
  static register(tool: Tool): void {
    this.tools.set(tool.id, tool)
  }

  /**
   * Get a tool by ID
   */
  static get(id: string): Tool | undefined {
    return this.tools.get(id)
  }

  /**
   * Check if a tool is registered
   */
  static has(id: string): boolean {
    return this.tools.has(id)
  }

  /**
   * Get all registered tools
   */
  static getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Import tools from the main application
   */
  static importTools(tools: Tool[]): void {
    tools.forEach(tool => {
      this.register(tool)
    })
  }

  /**
   * Check if a tool is available in the main application
   */
  static isAvailableInMainApp(id: string): boolean {
    return availableTools.includes(id)
  }

  /**
   * Get all available tool IDs from the main application
   */
  static getAllAvailableTools(): string[] {
    return [...availableTools]
  }
}

/**
 * Create a tool definition
 */
export function createTool(tool: Tool): Tool {
  return tool
}

export * from './registry' 