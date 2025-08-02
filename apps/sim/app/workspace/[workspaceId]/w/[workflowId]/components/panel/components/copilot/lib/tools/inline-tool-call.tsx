'use client'

/**
 * Inline Tool Call Component
 * Displays a tool call with its current state and optional confirmation UI
 */

import React, { useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CopilotToolCall, ToolState } from '@/stores/copilot/types'
import { toolRequiresInterrupt } from './utils'
import { toolRegistry } from './registry'
import { notifyServerTool } from './notification-utils'
import { useCopilotStore } from '@/stores/copilot/store'
import { renderToolStateIcon } from './utils'

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
  console.log('Server tool accepted:', toolCall.name, toolCall.id)
  
  // NEW LOGIC: Use centralized state management
  setToolCallState(toolCall, 'accepted')
  
  try {
    // Notify server of acceptance - execution happens elsewhere via SSE
    await notifyServerTool(toolCall.id, toolCall.name, 'accepted')
    console.log('Server notified of tool acceptance')
    
  } catch (error) {
    console.error('Failed to notify server of tool acceptance:', error)
    setToolCallState(toolCall, 'error', { error: 'Failed to notify server' })
  }
}

// Function to accept a client tool
async function clientAcceptTool(
  toolCall: CopilotToolCall,
  setToolCallState: (toolCall: any, state: string, options?: any) => void,
  context?: Record<string, any>
): Promise<void> {
  console.log('Client tool accepted:', toolCall.name, toolCall.id)
  
  console.log('Setting state to executing...')
  setToolCallState(toolCall, 'executing')
  
  console.log('Returning early to test state change')
  
  try {
    // Get the tool and execute it directly
    const tool = toolRegistry.getTool(toolCall.name)
    if (tool) {
      await tool.execute(toolCall, {
        onStateChange: (state: any) => {
          setToolCallState(toolCall, state)
        },
        context
      })
    } else {
      throw new Error(`Tool not found: ${toolCall.name}`)
    }
  } catch (error) {
    console.error('Error executing client tool:', error)
    setToolCallState(toolCall, 'errored', { 
      error: error instanceof Error ? error.message : 'Tool execution failed' 
    })
  }
}

// Function to reject any tool
async function rejectTool(
  toolCall: CopilotToolCall,
  setToolCallState: (toolCall: any, state: string, options?: any) => void
): Promise<void> {
  console.log('Tool rejected:', toolCall.name, toolCall.id)
  
  // NEW LOGIC: Use centralized state management
  setToolCallState(toolCall, 'rejected')
  
  try {
    // Notify server for both client and server tools
    await notifyServerTool(toolCall.id, toolCall.name, 'rejected')
    console.log('Server notified of tool rejection')
    
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
function RunSkipButtons({ toolCall, onStateChange, context }: { 
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void 
  context?: Record<string, any>
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [showBackgroundButton, setShowBackgroundButton] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const { setToolCallState } = useCopilotStore()
  
  // Check if this tool supports background execution
  const clientTool = toolRegistry.getTool(toolCall.name)
  const allowsBackground = clientTool?.metadata?.allowBackgroundExecution || false
  
  const handleRun = async () => {
    setIsProcessing(true)
    setButtonsHidden(true) // Hide run/skip buttons immediately
    
    try {
      // Check if it's a client tool or server tool
      const clientTool = toolRegistry.getTool(toolCall.name)
      
      if (clientTool) {
        // For client tools with background support, show background button during execution
        if (allowsBackground) {
          setShowBackgroundButton(true)
        }
        
        // Client tool - execute immediately
        await clientAcceptTool(toolCall, setToolCallState, context)
      } else {
        // Server tool
        await serverAcceptTool(toolCall, setToolCallState)
      }
      
      // Trigger re-render by calling onStateChange if provided
      onStateChange?.(toolCall.state)
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
  
  const handleMoveToBackground = async () => {
    setIsProcessing(true)
    
    try {
      // Move the tool execution to background
      setToolCallState(toolCall, 'background')
      
      // Notify the backend about background state
      await notifyServerTool(toolCall.id, toolCall.name, 'background')
      
      // Trigger re-render
      onStateChange?.(toolCall.state)
    } catch (error) {
      console.error('Error moving to background:', error)
    } finally {
      setIsProcessing(false)
    }
  }
  
  // If showing background button, only show that
  if (showBackgroundButton) {
    return (
      <div className='flex items-center gap-1.5'>
        <Button
          onClick={handleMoveToBackground}
          disabled={isProcessing}
          size='sm'
          className='h-6 bg-blue-600 px-2 font-medium text-white text-xs hover:bg-blue-700 disabled:opacity-50'
        >
          {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
          Move to Background
        </Button>
      </div>
    )
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

export function InlineToolCall({ 
  toolCall,
  onStateChange,
  context 
}: InlineToolCallProps) {
  const [, forceUpdate] = useState({})
  
  if (!toolCall) {
    return null
  }

  const showButtons = shouldShowRunSkipButtons(toolCall)
  
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
        <div className='flex-shrink-0'>
          {renderToolStateIcon(toolCall, 'h-3 w-3')}
        </div>
        <span className='text-sm'>{displayName}</span>
      </div>
      
      {showButtons && <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} context={context} />}
    </div>
  )
} 