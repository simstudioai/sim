/**
 * Copilot Tools Utilities
 * Handles all tool display logic and UI components
 */

import React from 'react'
import {
  BetweenHorizontalEnd,
  Blocks,
  Brain,
  Check,
  CheckCircle,
  Code,
  Database,
  Edit,
  Eye,
  FileText,
  GitBranch,
  Globe,
  Grid2x2,
  Grid2x2Check,
  Grid2x2X,
  Info,
  Lightbulb,
  ListTodo,
  Loader2,
  type LucideIcon,
  Minus,
  Network,
  Play,
  Search,
  Settings,
  SquareTerminal,
  Terminal,
  TreePalm,
  Variable,
  Workflow,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { toolRegistry } from '@/lib/copilot/tools/registry'
import type { CopilotToolCall, ToolState } from '@/lib/copilot/tools/types'

/**
 * Map icon identifiers to Lucide icon components
 */
const ICON_MAP: Record<string, LucideIcon> = {
  // Tool-specific icons
  edit: Edit,
  loader: Loader2,
  spinner: Loader2, // Standard spinner icon
  check: Check,
  checkCircle: CheckCircle,
  skip: Minus,
  error: XCircle,
  background: Eye,
  play: Play,
  wrench: Wrench, // Using Zap as wrench icon

  // Generic icons for tools
  search: Search,
  code: Code,
  file: FileText,
  database: Database,
  globe: Globe,
  zap: Zap,
  lightbulb: Lightbulb,
  eye: Eye,
  x: X,
  blocks: Blocks, // Blocks icon with missing corner
  betweenHorizontalEnd: BetweenHorizontalEnd, // Icon for block metadata
  grid2x2: Grid2x2, // Grid for ready for review
  grid2x2Check: Grid2x2Check, // Grid with checkmark for accepted workflow changes
  grid2x2X: Grid2x2X, // Grid with X for rejected workflow changes
  info: Info,
  terminal: Terminal,
  squareTerminal: SquareTerminal,
  tree: TreePalm,
  variable: Variable,
  template: FileText, // Using FileText for templates
  settings: Settings, // Gear/cog icon for configuration
  workflow: Workflow, // Flowchart icon with boxes and connecting lines
  network: Network, // Complex network icon with multiple interconnected nodes
  gitbranch: GitBranch, // Git branching icon showing workflow paths
  brain: Brain, // Brain icon for reasoning/AI thinking
  listTodo: ListTodo, // List with checkboxes for planning/todos

  // Default
  default: Lightbulb,
}

/**
 * Get the React icon component for a tool state
 */
export function getToolIcon(toolCall: CopilotToolCall): LucideIcon {
  // Check if it's a client tool
  const clientTool = toolRegistry.getTool(toolCall.name)
  if (clientTool) {
    const iconName = clientTool.getIcon(toolCall)
    return ICON_MAP[iconName] || ICON_MAP.default
  }

  // For server tools, use server tool metadata
  const serverToolMetadata = toolRegistry.getServerToolMetadata(toolCall.name)
  if (serverToolMetadata) {
    const stateConfig =
      serverToolMetadata.displayConfig.states[
        toolCall.state as keyof typeof serverToolMetadata.displayConfig.states
      ]
    if (stateConfig?.icon) {
      return ICON_MAP[stateConfig.icon] || ICON_MAP.default
    }
  }

  // Fallback to default icon
  return ICON_MAP.default
}

/**
 * Get the display name for a tool in its current state
 */
export function getToolDisplayName(toolCall: CopilotToolCall): string {
  const tool = toolRegistry.getTool(toolCall.name)
  if (!tool) return toolCall.name

  return tool.getDisplayName(toolCall)
}

/**
 * Check if a tool requires user confirmation in its current state
 */
export function toolRequiresConfirmation(toolCall: CopilotToolCall): boolean {
  const tool = toolRegistry.getTool(toolCall.name)
  if (tool) {
    // Client-side tool
    return tool.requiresConfirmation(toolCall)
  }

  // Server-side tool - check if it requires interrupt and is in pending state
  const requiresInterrupt = toolRegistry.requiresInterrupt(toolCall.name)
  return requiresInterrupt && toolCall.state === 'pending'
}

/**
 * Check if a tool requires user confirmation by tool name (for pending state)
 */
export function toolRequiresInterrupt(toolName: string): boolean {
  return toolRegistry.requiresInterrupt(toolName)
}

/**
 * Get CSS classes for tool state
 */
export function getToolStateClasses(state: ToolState): string {
  switch (state) {
    case 'pending':
      return 'text-muted-foreground'
    case 'executing':
      return 'text-yellow-600'
    case 'success':
      return 'text-green-600'
    case 'accepted':
      return 'text-blue-600'
    case 'rejected':
      return 'text-gray-500'
    case 'errored':
      return 'text-red-500'
    case 'background':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * Render the appropriate icon for a tool state
 */
export function renderToolStateIcon(
  toolCall: CopilotToolCall,
  className = 'h-3 w-3'
): React.ReactElement {
  const Icon = getToolIcon(toolCall)
  const stateClasses = getToolStateClasses(toolCall.state)

  // Special rendering for certain states
  if (toolCall.state === 'executing') {
    return React.createElement(Icon, { className: `${className} animate-spin ${stateClasses}` })
  }

  // Remove hardcoded rejected state override - let tool definitions control the icon

  return React.createElement(Icon, { className: `${className} ${stateClasses}` })
}

/**
 * Handle tool execution with proper state management
 */
export async function executeToolWithStateManagement(
  toolCall: CopilotToolCall,
  action: 'run' | 'skip' | 'background',
  options: {
    onStateChange: (state: ToolState) => void
    context?: Record<string, any>
  }
): Promise<void> {
  const tool = toolRegistry.getTool(toolCall.name)
  if (!tool) {
    console.error(`Tool not found: ${toolCall.name}`)
    return
  }

  await tool.handleUserAction(toolCall, action, {
    onStateChange: options.onStateChange,
    context: options.context,
  })
}

/**
 * Props for the tool confirmation component
 */
export interface ToolConfirmationProps {
  toolCall: CopilotToolCall
  onAction: (action: 'run' | 'skip' | 'background') => void
  isProcessing?: boolean
  showBackground?: boolean
}

/**
 * Tool action button props
 */
interface ToolActionButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant: 'primary' | 'secondary' | 'tertiary'
  size?: 'sm' | 'md'
}

/**
 * Create a tool action button with consistent styling
 */
export function createToolActionButton({
  label,
  onClick,
  disabled = false,
  loading = false,
  variant,
  size = 'sm',
}: ToolActionButtonProps): React.ReactElement {
  const baseClasses = 'font-medium transition-colors disabled:opacity-50'

  const sizeClasses = size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm'

  const variantClasses = {
    primary:
      'bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200',
    secondary:
      'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
    tertiary:
      'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
  }

  return React.createElement(
    'button',
    {
      onClick,
      disabled,
      className: `${baseClasses} ${sizeClasses} ${variantClasses[variant]}`,
    },
    loading && React.createElement(Loader2, { className: 'mr-1 h-3 w-3 animate-spin' }),
    label
  )
}
