'use client'

/**
 * Inline Tool Call Component
 * Displays a tool call with its current state and optional confirmation UI
 */

import React, { useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CopilotToolCall } from './types'
import { toolRequiresInterrupt } from './utils'
import { toolRegistry } from './registry'

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

// Function to accept a server tool
function serverAcceptTool(toolCall: CopilotToolCall): void {
  console.log('Server tool accepted:', toolCall.name, toolCall.id)
  toolCall.state = 'accepted'
}

// Function to accept a client tool
function clientAcceptTool(toolCall: CopilotToolCall): void {
  console.log('Client tool accepted:', toolCall.name, toolCall.id)
  toolCall.state = 'accepted'
}

// Function to reject any tool
function rejectTool(toolCall: CopilotToolCall): void {
  console.log('Tool rejected:', toolCall.name, toolCall.id)
  toolCall.state = 'rejected'
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
function RunSkipButtons({ toolCall, onStateChange }: { 
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void 
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  
  const handleRun = () => {
    setIsProcessing(true)
    
    // Check if it's a client tool or server tool
    const clientTool = toolRegistry.getTool(toolCall.name)
    
    if (clientTool) {
      // Client tool
      clientAcceptTool(toolCall)
    } else {
      // Server tool
      serverAcceptTool(toolCall)
    }
    
    // Trigger re-render by calling onStateChange if provided
    onStateChange?.(toolCall.state)
    setIsProcessing(false)
  }
  
  const handleSkip = () => {
    setIsProcessing(true)
    
    rejectTool(toolCall)
    
    // Trigger re-render by calling onStateChange if provided
    onStateChange?.(toolCall.state)
    setIsProcessing(false)
  }
  
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
          <Wrench className='h-3 w-3' />
        </div>
        <span className='text-sm'>{displayName}</span>
      </div>
      
      {showButtons && <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} />}
    </div>
  )
} 