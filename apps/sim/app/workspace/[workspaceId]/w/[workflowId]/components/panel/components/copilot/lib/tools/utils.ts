/**
 * Copilot Tools Utilities
 * Handles all tool display logic and UI components
 */

import React from 'react'
import { 
  Check,
  CheckCircle,
  Code,
  Database,
  Edit,
  Eye,
  FileText,
  Globe,
  Lightbulb,
  Loader2,
  Minus,
  Play,
  Search,
  X,
  XCircle,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ToolCall, ToolState } from './types'
import { toolRegistry } from './registry'

/**
 * Map icon identifiers to Lucide icon components
 */
const ICON_MAP: Record<string, LucideIcon> = {
  // Tool-specific icons
  edit: Edit,
  loader: Loader2,
  check: Check,
  checkCircle: CheckCircle,
  skip: Minus,
  error: XCircle,
  background: Eye,
  play: Play,
  wrench: Zap, // Using Zap as wrench icon
  
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
  
  // Default
  default: Lightbulb
}

/**
 * Get the React icon component for a tool state
 */
export function getToolIcon(toolCall: ToolCall): LucideIcon {
  const tool = toolRegistry.getTool(toolCall.name)
  if (!tool) return ICON_MAP.default

  const iconName = tool.getIcon(toolCall)
  return ICON_MAP[iconName] || ICON_MAP.default
}

/**
 * Get the display name for a tool in its current state
 */
export function getToolDisplayName(toolCall: ToolCall): string {
  const tool = toolRegistry.getTool(toolCall.name)
  if (!tool) return toolCall.name

  return tool.getDisplayName(toolCall)
}

/**
 * Check if a tool requires user confirmation in its current state
 */
export function toolRequiresConfirmation(toolCall: ToolCall): boolean {
  const tool = toolRegistry.getTool(toolCall.name)
  if (!tool) return false

  return tool.requiresConfirmation(toolCall)
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
export function renderToolStateIcon(toolCall: ToolCall, className: string = 'h-3 w-3'): React.ReactElement {
  const Icon = getToolIcon(toolCall)
  const stateClasses = getToolStateClasses(toolCall.state)
  
  // Special rendering for certain states
  if (toolCall.state === 'executing') {
    return React.createElement(Icon, { className: `${className} animate-spin ${stateClasses}` })
  }
  
  if (toolCall.state === 'rejected') {
    // Special "skipped" icon style
    return React.createElement('div', 
      { className: `flex ${className} items-center justify-center rounded-full border border-gray-400` },
      React.createElement(Minus, { className: 'h-2 w-2 text-gray-500' })
    )
  }
  
  return React.createElement(Icon, { className: `${className} ${stateClasses}` })
}

/**
 * Handle tool execution with proper state management
 */
export async function executeToolWithStateManagement(
  toolCall: ToolCall,
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
    context: options.context
  })
}

/**
 * Props for the tool confirmation component
 */
export interface ToolConfirmationProps {
  toolCall: ToolCall
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
  size = 'sm'
}: ToolActionButtonProps): React.ReactElement {
  const baseClasses = 'font-medium transition-colors disabled:opacity-50'
  
  const sizeClasses = size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm'
  
  const variantClasses = {
    primary: 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200',
    secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
    tertiary: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
  }

  return React.createElement('button',
    {
      onClick,
      disabled,
      className: `${baseClasses} ${sizeClasses} ${variantClasses[variant]}`
    },
    loading && React.createElement(Loader2, { className: 'mr-1 h-3 w-3 animate-spin' }),
    label
  )
} 