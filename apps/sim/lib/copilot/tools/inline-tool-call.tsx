'use client'

/**
 * Inline Tool Call Component
 * Displays a tool call with its current state and optional confirmation UI
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notifyServerTool } from '@/lib/copilot/tools/notification-utils'
import { toolRegistry } from '@/lib/copilot/tools/registry'
import { renderToolStateIcon, toolRequiresInterrupt } from '@/lib/copilot/tools/utils'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotToolCall } from '@/stores/copilot/types'

interface InlineToolCallProps {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
  context?: Record<string, any>
}

// Simple function to check if tool call should show run/skip buttons
function shouldShowRunSkipButtons(toolCall: CopilotToolCall): boolean {
  // Check if tool requires interrupt and is in pending state
  return toolRequiresInterrupt(toolCall.name) && toolCall.state === 'pending'
}

// Function to accept a server tool (interrupt required)
async function serverAcceptTool(
  toolCall: CopilotToolCall,
  setToolCallState: (toolCall: any, state: string, options?: any) => void
): Promise<void> {
  // Set state directly to executing (skip accepted state)
  setToolCallState(toolCall, 'executing')

  try {
    // Notify server of acceptance - execution happens elsewhere via SSE
    await notifyServerTool(toolCall.id, toolCall.name, 'accepted')
  } catch (error) {
    console.error('Failed to notify server of tool acceptance:', error)
    setToolCallState(toolCall, 'error', { error: 'Failed to notify server' })
  }
}

// Function to accept a client tool
async function clientAcceptTool(
  toolCall: CopilotToolCall,
  setToolCallState: (toolCall: any, state: string, options?: any) => void,
  onStateChange?: (state: any) => void,
  context?: Record<string, any>
): Promise<void> {
  setToolCallState(toolCall, 'executing')

  // Trigger UI update immediately with explicit state
  onStateChange?.('executing')

  try {
    // Get the tool and execute it directly
    const tool = toolRegistry.getTool(toolCall.name)
    if (tool) {
      await tool.execute(toolCall, {
        onStateChange: (state: any) => {
          setToolCallState(toolCall, state)
        },
        context,
      })
    } else {
      throw new Error(`Tool not found: ${toolCall.name}`)
    }
  } catch (error) {
    console.error('Error executing client tool:', error)
    const errorMessage = error instanceof Error ? error.message : 'Tool execution failed'
    const failedDependency =
      error && typeof error === 'object' && 'failedDependency' in error
        ? (error as any).failedDependency
        : false
    // Check if failedDependency is true to set 'rejected' state instead of 'errored'
    const targetState = failedDependency === true ? 'rejected' : 'errored'
    setToolCallState(toolCall, targetState, {
      error: errorMessage,
    })
  }
}

// Function to reject any tool
async function rejectTool(
  toolCall: CopilotToolCall,
  setToolCallState: (toolCall: any, state: string, options?: any) => void
): Promise<void> {
  // NEW LOGIC: Use centralized state management
  setToolCallState(toolCall, 'rejected')

  try {
    // Notify server for both client and server tools
    await notifyServerTool(toolCall.id, toolCall.name, 'rejected')
  } catch (error) {
    console.error('Failed to notify server of tool rejection:', error)
  }
}

// Function to get tool display name based on state
function getToolDisplayNameByState(toolCall: CopilotToolCall): string {
  const toolName = toolCall.name
  const state = toolCall.state

  // Check if it's a client tool
  const clientTool = toolRegistry.getTool(toolName)
  if (clientTool) {
    // Use client tool's display name logic
    return clientTool.getDisplayName(toolCall)
  }

  // For server tools, use server tool metadata
  const serverToolMetadata = toolRegistry.getServerToolMetadata(toolName)
  if (serverToolMetadata) {
    // Check if there's a dynamic display name function
    if (serverToolMetadata.displayConfig.getDynamicDisplayName) {
      const dynamicName = serverToolMetadata.displayConfig.getDynamicDisplayName(
        state,
        toolCall.input || toolCall.parameters || {}
      )
      if (dynamicName) return dynamicName
    }

    // Use state-specific display config
    const stateConfig = serverToolMetadata.displayConfig.states[state]
    if (stateConfig) {
      return stateConfig.displayName
    }
  }

  // Fallback to tool name if no specific display logic found
  return toolName
}

// Simple run/skip buttons component
function RunSkipButtons({
  toolCall,
  onStateChange,
  context,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
  context?: Record<string, any>
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const { setToolCallState } = useCopilotStore()

  const handleRun = async () => {
    setIsProcessing(true)
    setButtonsHidden(true) // Hide run/skip buttons immediately

    try {
      // Check if it's a client tool or server tool
      const clientTool = toolRegistry.getTool(toolCall.name)

      if (clientTool) {
        // Client tool - execute immediately
        await clientAcceptTool(toolCall, setToolCallState, onStateChange, context)
        // Trigger re-render after tool execution completes
        onStateChange?.(toolCall.state)
      } else {
        // Server tool
        await serverAcceptTool(toolCall, setToolCallState)
        // Trigger re-render by calling onStateChange if provided
        onStateChange?.(toolCall.state)
      }
    } catch (error) {
      console.error('Error handling run action:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSkip = async () => {
    setIsProcessing(true)
    setButtonsHidden(true) // Hide run/skip buttons immediately

    try {
      await rejectTool(toolCall, setToolCallState)

      // Trigger re-render by calling onStateChange if provided
      onStateChange?.(toolCall.state)
    } catch (error) {
      console.error('Error handling skip action:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  // If buttons are hidden, show nothing
  if (buttonsHidden) {
    return null
  }

  // Default run/skip buttons
  return (
    <div className='flex items-center gap-1.5'>
      <Button
        onClick={handleRun}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-900 px-2 font-medium text-white text-xs hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
      >
        {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
        Run
      </Button>
      <Button
        onClick={handleSkip}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-200 px-2 font-medium text-gray-700 text-xs hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
      >
        Skip
      </Button>
    </div>
  )
}

export function InlineToolCall({ toolCall, onStateChange, context }: InlineToolCallProps) {
  const [, forceUpdate] = useState({})
  const { setToolCallState } = useCopilotStore()

  if (!toolCall) {
    return null
  }

  const showButtons = shouldShowRunSkipButtons(toolCall)

  // Check if we should show background button (when in executing state)
  const clientTool = toolRegistry.getTool(toolCall.name)
  const allowsBackground = clientTool?.metadata?.allowBackgroundExecution || false
  const showBackgroundButton = allowsBackground && toolCall.state === 'executing' && !showButtons

  const handleStateChange = (state: any) => {
    // Force component re-render
    forceUpdate({})
    // Call parent onStateChange if provided
    onStateChange?.(state)
  }

  const displayName = getToolDisplayNameByState(toolCall)

  return (
    <div className='flex items-center justify-between gap-2 py-1'>
      <div className='flex items-center gap-2 text-muted-foreground'>
        <div className='flex-shrink-0'>{renderToolStateIcon(toolCall, 'h-3 w-3')}</div>
        <span className='text-base'>{displayName}</span>
      </div>

      {showButtons && (
        <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} context={context} />
      )}

      {showBackgroundButton && (
        <div className='flex items-center gap-1.5'>
          <Button
            onClick={async () => {
              try {
                // Set tool state to background
                setToolCallState(toolCall, 'background')

                // Notify the backend about background state
                await notifyServerTool(toolCall.id, toolCall.name, 'background')

                // Track that this tool was moved to background
                if (context) {
                  if (!context.movedToBackgroundToolIds) {
                    context.movedToBackgroundToolIds = new Set()
                  }
                  context.movedToBackgroundToolIds.add(toolCall.id)
                }

                // Trigger re-render
                onStateChange?.(toolCall.state)
              } catch (error) {
                console.error('Error moving to background:', error)
              }
            }}
            size='sm'
            className='h-6 bg-blue-600 px-2 font-medium text-white text-xs hover:bg-blue-700'
          >
            Move to Background
          </Button>
        </div>
      )}
    </div>
  )
}
