/**
 * Tool Registry - Central management for client-side copilot tools
 *
 * This registry manages tools that:
 * - Require user interrupts/confirmation (requiresInterrupt: true)
 * - Execute client-side logic
 *
 * It also provides metadata for server-side tools for display purposes
 */

import { BuildWorkflowClientTool } from '@/lib/copilot/tools/client-tools/build-workflow'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client-tools/edit-workflow'
import { GDriveRequestAccessTool } from '@/lib/copilot/tools/client-tools/gdrive-request-access'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client-tools/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client-tools/get-blocks-metadata'
import { GetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client-tools/get-environment-variables'
import { GetOAuthCredentialsClientTool } from '@/lib/copilot/tools/client-tools/get-oauth-credentials'
import { GetUserWorkflowTool } from '@/lib/copilot/tools/client-tools/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client-tools/get-workflow-console'
import { ListGDriveFilesClientTool } from '@/lib/copilot/tools/client-tools/list-gdrive-files'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client-tools/make-api-request'
import { OnlineSearchClientTool } from '@/lib/copilot/tools/client-tools/online-search'
import { ReadGDriveFileClientTool } from '@/lib/copilot/tools/client-tools/read-gdrive-file'
import { RunWorkflowTool } from '@/lib/copilot/tools/client-tools/run-workflow'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client-tools/search-documentation'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client-tools/set-environment-variables'
import { SERVER_TOOL_METADATA } from '@/lib/copilot/tools/server-tools/definitions'
import type { Tool, ToolMetadata } from '@/lib/copilot/tools/types'

/**
 * Tool Registry class that manages all available tools
 */
export class ToolRegistry {
  private static instance: ToolRegistry
  private tools: Map<string, Tool> = new Map()

  private constructor() {
    // Register all tools on initialization
    this.registerDefaultTools()
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
    // Check client tools first
    const tool = this.getTool(toolId)
    if (tool) {
      return tool.metadata.requiresInterrupt ?? false
    }

    // Check server tools
    const serverToolMetadata = SERVER_TOOL_METADATA[toolId as keyof typeof SERVER_TOOL_METADATA]
    return serverToolMetadata?.requiresInterrupt ?? false
  }

  /**
   * Get server tool metadata by ID
   */
  getServerToolMetadata(toolId: string): ToolMetadata | undefined {
    return SERVER_TOOL_METADATA[toolId as keyof typeof SERVER_TOOL_METADATA]
  }

  /**
   * Register default client tools
   */
  private registerDefaultTools(): void {
    // Register actual client tool implementations
    this.register(new RunWorkflowTool())
    this.register(new GetUserWorkflowTool())
    this.register(new GDriveRequestAccessTool())
    this.register(new GetBlocksAndToolsClientTool())
    this.register(new GetEnvironmentVariablesClientTool())
    this.register(new GetOAuthCredentialsClientTool())
    this.register(new GetBlocksMetadataClientTool())
    this.register(new SearchDocumentationClientTool())
    this.register(new OnlineSearchClientTool())
    this.register(new ListGDriveFilesClientTool())
    this.register(new ReadGDriveFileClientTool())
    this.register(new GetWorkflowConsoleClientTool())
    this.register(new MakeApiRequestClientTool())
    this.register(new SetEnvironmentVariablesClientTool())
    this.register(new BuildWorkflowClientTool())
    this.register(new EditWorkflowClientTool())
  }
}

// Export singleton instance
export const toolRegistry = ToolRegistry.getInstance()
