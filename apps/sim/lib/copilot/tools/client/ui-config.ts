/**
 * UI Configuration Types for Copilot Tools
 *
 * This module defines the configuration interfaces that control how tools
 * are rendered in the tool-call component. All UI behavior should be defined
 * here rather than hardcoded in the rendering component.
 */
import type { LucideIcon } from 'lucide-react'
import type { ClientToolCallState } from './base-tool'

/**
 * Configuration for a params table column
 */
export interface ParamsTableColumn {
  /** Key to extract from params */
  key: string
  /** Display label for the column header */
  label: string
  /** Width as percentage or CSS value */
  width?: string
  /** Whether values in this column are editable */
  editable?: boolean
  /** Whether to use monospace font */
  mono?: boolean
  /** Whether to mask the value (for passwords) */
  masked?: boolean
}

/**
 * Configuration for params table rendering
 */
export interface ParamsTableConfig {
  /** Column definitions */
  columns: ParamsTableColumn[]
  /**
   * Extract rows from tool params.
   * Returns array of [key, ...cellValues] for each row.
   */
  extractRows: (params: Record<string, any>) => Array<[string, ...any[]]>
  /**
   * Optional: Update params when a cell is edited.
   * Returns the updated params object.
   */
  updateCell?: (
    params: Record<string, any>,
    rowKey: string,
    columnKey: string,
    newValue: any
  ) => Record<string, any>
}

/**
 * Configuration for secondary action button (like "Move to Background")
 */
export interface SecondaryActionConfig {
  /** Button text */
  text: string
  /** Button title/tooltip */
  title?: string
  /** Button variant */
  variant?: 'tertiary' | 'default' | 'outline'
  /** States in which to show this button */
  showInStates: ClientToolCallState[]
  /**
   * Message to send when the action is triggered.
   * Used by markToolComplete.
   */
  completionMessage?: string
  /**
   * Target state after action.
   * If not provided, defaults to 'background'.
   */
  targetState?: ClientToolCallState
}

/**
 * Configuration for subagent tools (tools that spawn subagents)
 */
export interface SubagentConfig {
  /** Label shown while streaming (e.g., "Planning", "Editing") */
  streamingLabel: string
  /** Label shown when complete (e.g., "Planned", "Edited") */
  completedLabel: string
  /**
   * Whether the content should collapse when streaming ends.
   * Default: true
   */
  shouldCollapse?: boolean
  /**
   * Output artifacts that should NOT be collapsed.
   * These are rendered outside the collapsible content.
   * Examples: 'plan' for PlanSteps, 'options' for OptionsSelector
   */
  outputArtifacts?: Array<'plan' | 'options' | 'edit_summary'>
  /**
   * Whether this subagent renders its own specialized content
   * and the thinking text should be minimal or hidden.
   * Used for tools like 'edit' where we show WorkflowEditSummary instead.
   */
  hideThinkingText?: boolean
}

/**
 * Interrupt button configuration
 */
export interface InterruptButtonConfig {
  text: string
  icon: LucideIcon
}

/**
 * Configuration for interrupt behavior (Run/Skip buttons)
 */
export interface InterruptConfig {
  /** Accept button config */
  accept: InterruptButtonConfig
  /** Reject button config */
  reject: InterruptButtonConfig
  /**
   * Whether to show "Allow Once" button (default accept behavior).
   * Default: true
   */
  showAllowOnce?: boolean
  /**
   * Whether to show "Allow Always" button (auto-approve this tool in future).
   * Default: true for most tools
   */
  showAllowAlways?: boolean
}

/**
 * Complete UI configuration for a tool
 */
export interface ToolUIConfig {
  /**
   * Whether this is a "special" tool that gets gradient styling.
   * Used for workflow operation tools like edit_workflow, build_workflow, etc.
   */
  isSpecial?: boolean

  /**
   * Interrupt configuration for tools that require user confirmation.
   * If not provided, tool auto-executes.
   */
  interrupt?: InterruptConfig

  /**
   * Secondary action button (like "Move to Background" for run_workflow)
   */
  secondaryAction?: SecondaryActionConfig

  /**
   * Configuration for rendering params as a table.
   * If provided, tool will show an expandable/inline table.
   */
  paramsTable?: ParamsTableConfig

  /**
   * Subagent configuration for tools that spawn subagents.
   * If provided, tool is treated as a subagent tool.
   */
  subagent?: SubagentConfig

  /**
   * Whether this tool should always show params expanded (not collapsible).
   * Used for tools like set_environment_variables that always show their table.
   */
  alwaysExpanded?: boolean

  /**
   * Custom component type for special rendering.
   * The tool-call component will use this to render specialized content.
   */
  customRenderer?: 'code' | 'edit_summary' | 'none'
}

/**
 * Registry of tool UI configurations.
 * Tools can register their UI config here for the tool-call component to use.
 */
const toolUIConfigs: Record<string, ToolUIConfig> = {}

/**
 * Register a tool's UI configuration
 */
export function registerToolUIConfig(toolName: string, config: ToolUIConfig): void {
  toolUIConfigs[toolName] = config
}

/**
 * Get a tool's UI configuration
 */
export function getToolUIConfig(toolName: string): ToolUIConfig | undefined {
  return toolUIConfigs[toolName]
}

/**
 * Check if a tool is a subagent tool
 */
export function isSubagentTool(toolName: string): boolean {
  return !!toolUIConfigs[toolName]?.subagent
}

/**
 * Check if a tool is a "special" tool (gets gradient styling)
 */
export function isSpecialTool(toolName: string): boolean {
  return !!toolUIConfigs[toolName]?.isSpecial
}

/**
 * Check if a tool has interrupt (requires user confirmation)
 */
export function hasInterrupt(toolName: string): boolean {
  return !!toolUIConfigs[toolName]?.interrupt
}

/**
 * Get subagent labels for a tool
 */
export function getSubagentLabels(
  toolName: string,
  isStreaming: boolean
): { streaming: string; completed: string } | undefined {
  const config = toolUIConfigs[toolName]?.subagent
  if (!config) return undefined
  return {
    streaming: config.streamingLabel,
    completed: config.completedLabel,
  }
}

/**
 * Get all registered tool UI configs (for debugging)
 */
export function getAllToolUIConfigs(): Record<string, ToolUIConfig> {
  return { ...toolUIConfigs }
}
