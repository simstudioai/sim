/**
 * Tool Registry - Central management for client-side copilot tools
 * 
 * This registry manages tools that:
 * - Require user interrupts/confirmation (requiresInterrupt: true)
 * - Execute client-side logic
 * 
 * It also provides metadata for server-side tools for display purposes
 */

import type { Tool, ToolMetadata } from './types'
import { BaseTool } from './base-tool'

// Import client tool implementations
import { SetEnvironmentVariablesTool } from './client-tools/set-environment-variables'
import { RunWorkflowTool } from './client-tools/run-workflow'

// Import server tool definitions
import { SERVER_TOOL_METADATA } from './server-tools/definitions'
import { ServerToolWrapper } from './server-tool-wrapper'

/**
 * Tool Registry class that manages all available tools
 */
export class ToolRegistry {
  private static instance: ToolRegistry
  private tools: Map<string, Tool> = new Map()

  private constructor() {
    // Register all tools on initialization
    this.registerDefaultTools()
    this.registerServerTools()
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry()
    }
    return ToolRegistry.instance
  }

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.metadata.id, tool)
  }

  /**
   * Get a tool by ID
   */
  getTool(toolId: string): Tool | undefined {
    return this.tools.get(toolId)
  }

  /**
   * Get tool metadata by ID
   */
  getToolMetadata(toolId: string): ToolMetadata | undefined {
    const tool = this.tools.get(toolId)
    return tool?.metadata
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get all tool IDs
   */
  getToolIds(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * Get all tool IDs as an object for easy access
   */
  getToolIdsObject(): Record<string, string> {
    const ids: Record<string, string> = {}
    
    this.tools.forEach((tool, id) => {
      const key = id.toUpperCase()
      ids[key] = id
    })
    
    return ids
  }

  /**
   * Check if a tool requires interrupt
   */
  requiresInterrupt(toolId: string): boolean {
    const tool = this.getTool(toolId)
    return tool?.metadata.requiresInterrupt ?? false
  }

  /**
   * Register default client tools
   */
  private registerDefaultTools(): void {
    // Register actual client tool implementations
    this.register(new SetEnvironmentVariablesTool())
    this.register(new RunWorkflowTool())
  }

  /**
   * Register server tool metadata as wrapped tools
   */
  private registerServerTools(): void {
    // Create wrapped tools for server tool metadata
    Object.values(SERVER_TOOL_METADATA).forEach(metadata => {
      this.register(new ServerToolWrapper(metadata))
    })
  }
}

// Export singleton instance
export const toolRegistry = ToolRegistry.getInstance() 