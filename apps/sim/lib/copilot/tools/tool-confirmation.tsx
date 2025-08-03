'use client'

/**
 * Tool Confirmation Component
 * Renders Run/Skip buttons for tools requiring user confirmation
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notifyServerTool } from '@/lib/copilot/tools/notification-utils'
import { toolRegistry } from '@/lib/copilot/tools/registry'
import type { CopilotToolCall } from '@/lib/copilot/tools/types'
import { executeToolWithStateManagement } from '@/lib/copilot/tools/utils'

interface ToolConfirmationProps {
  toolCall: CopilotToolCall
  onStateChange: (state: any) => void
  context?: Record<string, any>
  onConfirm?: () => void
  showBackground?: boolean
}

export function ToolConfirmation({
  toolCall,
  onStateChange,
  context,
  onConfirm,
  showBackground = false,
}: ToolConfirmationProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const [isMovingToBackground, setIsMovingToBackground] = useState(false)

  const handleAction = async (action: 'run' | 'skip' | 'background') => {
    if (isProcessing) return

    // Hide buttons immediately
    setButtonsHidden(true)

    if (action === 'background') {
      setIsMovingToBackground(true)
    } else {
      setIsProcessing(true)
    }

    try {
      // Call the confirmation callback if provided
      if (onConfirm) {
        onConfirm()
      }

      // Check if this is a server tool or client tool
      const isClientTool = toolRegistry.getTool(toolCall.name) !== undefined

      if (isClientTool) {
        // For client tools, use the existing state management system
        await executeToolWithStateManagement(toolCall, action, {
          onStateChange,
          context,
        })
      } else {
        // For server tools, use the notification system
        const toolState = action === 'run' ? 'accepted' : 'rejected'
        const uiState = action === 'run' ? 'accepted' : 'rejected'

        // Update UI state
        onStateChange(uiState)

        try {
          await notifyServerTool(toolCall.id, toolCall.name, toolState)
        } catch (error) {
          console.error(`Failed to notify server tool ${toolCall.id}:`, error)
          // Don't throw error for rejections - user explicitly chose to reject
          if (action === 'skip') {
            return
          }
          throw error
        }
      }
    } finally {
      setIsProcessing(false)
      setIsMovingToBackground(false)
    }
  }

  // Don't show buttons if already hidden
  if (buttonsHidden) {
    return null
  }

  return (
    <div className='flex items-center gap-1.5'>
      <Button
        onClick={() => handleAction('run')}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-900 px-2 font-medium text-white text-xs hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
      >
        {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
        Run
      </Button>
      <Button
        onClick={() => handleAction('skip')}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-200 px-2 font-medium text-gray-700 text-xs hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
      >
        Skip
      </Button>

      {showBackground && (
        <Button
          onClick={() => handleAction('background')}
          disabled={isMovingToBackground}
          size='sm'
          className='h-6 bg-gray-100 px-2 font-medium text-gray-600 text-xs hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        >
          {isMovingToBackground ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
          Move to background
        </Button>
      )}
    </div>
  )
}
