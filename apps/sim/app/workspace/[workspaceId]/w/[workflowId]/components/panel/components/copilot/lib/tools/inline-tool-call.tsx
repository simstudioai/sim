'use client'

/**
 * Inline Tool Call Component
 * Displays a tool call with its current state and optional confirmation UI
 */

import React from 'react'
import type { ToolCall } from './types'
import { 
  getToolDisplayName,
  renderToolStateIcon,
  toolRequiresConfirmation
} from './utils'
import { ToolConfirmation } from './tool-confirmation'

interface InlineToolCallProps {
  toolCall: ToolCall
  onStateChange: (state: any) => void
  context?: Record<string, any>
}

export function InlineToolCall({ 
  toolCall, 
  onStateChange,
  context 
}: InlineToolCallProps) {
  const displayName = getToolDisplayName(toolCall)
  const icon = renderToolStateIcon(toolCall)
  const requiresConfirmation = toolRequiresConfirmation(toolCall)
  
  // Special handling for run_workflow tool to show background option
  const showBackground = toolCall.name === 'run_workflow' && 
                        toolCall.state === 'executing' &&
                        context?.isWorkflowExecuting

  return (
    <div className='flex items-center justify-between gap-2 py-1'>
      <div className='flex items-center gap-2 text-muted-foreground'>
        <div className='flex-shrink-0'>{icon}</div>
        <span className='text-sm'>{displayName}</span>
      </div>

      {requiresConfirmation && (
        <ToolConfirmation
          toolCall={toolCall}
          onStateChange={onStateChange}
          context={context}
          showBackground={showBackground}
        />
      )}
    </div>
  )
} 