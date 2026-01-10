/**
 * Base class for subagent tools.
 *
 * Subagent tools spawn a server-side subagent that does the actual work.
 * The tool auto-executes and the subagent's output is streamed back
 * as nested content under the tool call.
 *
 * Examples: edit, plan, debug, evaluate, research, etc.
 */
import type { LucideIcon } from 'lucide-react'
import { BaseClientTool, type BaseClientToolMetadata, ClientToolCallState } from './base-tool'
import type { SubagentConfig, ToolUIConfig } from './ui-config'
import { registerToolUIConfig } from './ui-config'

/**
 * Configuration for creating a subagent tool
 */
export interface SubagentToolConfig {
  /** Unique tool ID */
  id: string
  /** Display names per state */
  displayNames: {
    streaming: { text: string; icon: LucideIcon }
    success: { text: string; icon: LucideIcon }
    error: { text: string; icon: LucideIcon }
  }
  /** Subagent UI configuration */
  subagent: SubagentConfig
  /**
   * Optional: Whether this is a "special" tool (gets gradient styling).
   * Default: false
   */
  isSpecial?: boolean
}

/**
 * Create metadata for a subagent tool from config
 */
function createSubagentMetadata(config: SubagentToolConfig): BaseClientToolMetadata {
  const { displayNames, subagent, isSpecial } = config
  const { streaming, success, error } = displayNames

  const uiConfig: ToolUIConfig = {
    isSpecial: isSpecial ?? false,
    subagent,
  }

  return {
    displayNames: {
      [ClientToolCallState.generating]: streaming,
      [ClientToolCallState.pending]: streaming,
      [ClientToolCallState.executing]: streaming,
      [ClientToolCallState.success]: success,
      [ClientToolCallState.error]: error,
      [ClientToolCallState.rejected]: {
        text: `${config.id.charAt(0).toUpperCase() + config.id.slice(1)} skipped`,
        icon: error.icon,
      },
      [ClientToolCallState.aborted]: {
        text: `${config.id.charAt(0).toUpperCase() + config.id.slice(1)} aborted`,
        icon: error.icon,
      },
    },
    uiConfig,
  }
}

/**
 * Base class for subagent tools.
 * Extends BaseClientTool with subagent-specific behavior.
 */
export abstract class BaseSubagentTool extends BaseClientTool {
  /**
   * Subagent configuration.
   * Override in subclasses to customize behavior.
   */
  static readonly subagentConfig: SubagentToolConfig

  constructor(toolCallId: string, config: SubagentToolConfig) {
    super(toolCallId, config.id, createSubagentMetadata(config))
    // Register UI config for this tool
    registerToolUIConfig(config.id, this.metadata.uiConfig!)
  }

  /**
   * Execute the subagent tool.
   * Immediately transitions to executing state - the actual work
   * is done server-side by the subagent.
   */
  async execute(_args?: Record<string, any>): Promise<void> {
    this.setState(ClientToolCallState.executing)
    // The tool result will come from the server via tool_result event
    // when the subagent completes its work
  }
}

/**
 * Factory function to create a subagent tool class.
 * Use this for simple subagent tools that don't need custom behavior.
 */
export function createSubagentToolClass(config: SubagentToolConfig) {
  // Register UI config at class creation time
  const uiConfig: ToolUIConfig = {
    isSpecial: config.isSpecial ?? false,
    subagent: config.subagent,
  }
  registerToolUIConfig(config.id, uiConfig)

  return class extends BaseClientTool {
    static readonly id = config.id

    constructor(toolCallId: string) {
      super(toolCallId, config.id, createSubagentMetadata(config))
    }

    async execute(_args?: Record<string, any>): Promise<void> {
      this.setState(ClientToolCallState.executing)
    }
  }
}
