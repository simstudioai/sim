'use client'

/**
 * Inline Tool Call Component
 * Displays a tool call with its current state and optional confirmation UI
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import useDrivePicker from 'react-google-drive-picker'
import { GoogleDriveIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { notifyServerTool } from '@/lib/copilot/tools/notification-utils'
import { toolRegistry } from '@/lib/copilot/tools/registry'
import { renderToolStateIcon, toolRequiresInterrupt } from '@/lib/copilot/tools/utils'
import { getEnv } from '@/lib/env'
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
  const [openPicker] = useDrivePicker()

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

  const handleOpenDriveAccess = async () => {
    try {
      const providerId = 'google-drive'
      const credsRes = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)
      if (!credsRes.ok) return
      const credsData = await credsRes.json()
      const creds = Array.isArray(credsData.credentials) ? credsData.credentials : []
      if (creds.length === 0) return
      const defaultCred = creds.find((c: any) => c.isDefault) || creds[0]

      const tokenRes = await fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: defaultCred.id }),
      })
      if (!tokenRes.ok) return
      const { accessToken } = await tokenRes.json()
      if (!accessToken) return

      const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
      const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''
      const projectNumber = getEnv('NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER') || ''

      openPicker({
        clientId,
        developerKey: apiKey,
        viewId: 'DOCS',
        token: accessToken,
        showUploadView: true,
        showUploadFolders: true,
        supportDrives: true,
        multiselect: false,
        appId: projectNumber,
        setSelectFolderEnabled: false,
        callbackFunction: async (data) => {
          if (data.action === 'picked') {
            await handleRun()
          }
        },
      })
    } catch (e) {
      console.error('Failed to open Google Drive picker', e)
    }
  }

  // If buttons are hidden, show nothing
  if (buttonsHidden) {
    return null
  }

  // Special inline UI for Google Drive access request
  if (toolCall.name === 'gdrive_request_access' && toolCall.state === 'pending') {
    return (
      <div className='flex items-center gap-2'>
        <Button
          onClick={handleOpenDriveAccess}
          size='sm'
          className='h-6 bg-gray-900 px-2 font-medium text-white text-xs hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
          title='Grant Google Drive access'
        >
          <GoogleDriveIcon className='mr-0.5 h-4 w-4' />
          Select
        </Button>
        <Button
          onClick={async () => {
            setButtonsHidden(true)
            await rejectTool(toolCall, setToolCallState)
            onStateChange?.(toolCall.state)
          }}
          size='sm'
          className='h-6 bg-gray-200 px-2 font-medium text-gray-700 text-xs hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
        >
          Skip
        </Button>
      </div>
    )
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
        onClick={async () => {
          setButtonsHidden(true)
          await rejectTool(toolCall, setToolCallState)
          onStateChange?.(toolCall.state)
        }}
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

  const isExpandablePending =
    toolCall.state === 'pending' &&
    (toolCall.name === 'make_api_request' || toolCall.name === 'set_environment_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const isExpandableTool =
    toolCall.name === 'make_api_request' || toolCall.name === 'set_environment_variables'

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

  const params = (toolCall.parameters || toolCall.input || {}) as Record<string, any>

  const Chip = ({
    children,
    color = 'gray',
  }: {
    children: any
    color?: 'gray' | 'green' | 'blue' | 'yellow'
  }) => (
    <span
      className={
        'inline-flex items-center rounded px-1.5 py-0.5 font-semibold text-[10px] ' +
        (color === 'green'
          ? 'bg-emerald-100 text-emerald-700'
          : color === 'blue'
            ? 'bg-blue-100 text-blue-700'
            : color === 'yellow'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-700')
      }
    >
      {children}
    </span>
  )

  const KeyVal = ({ k, v }: { k: string; v: any }) => (
    <div className='flex items-start justify-between gap-2'>
      <span className='min-w-[110px] shrink-0 truncate font-medium text-[11px] text-muted-foreground'>
        {k}
      </span>
      <span className='w-full overflow-hidden font-mono text-[11px] text-foreground'>
        {String(v)}
      </span>
    </div>
  )

  const Section = ({ title, children }: { title: string; children: any }) => (
    <Card className='mt-1.5'>
      <CardContent className='p-3'>
        <div className='mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
          {title}
        </div>
        {children}
      </CardContent>
    </Card>
  )

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = params.url || ''
      const method = (params.method || '').toUpperCase()
      const methodColor = method === 'GET' ? 'green' : method === 'POST' ? 'blue' : 'yellow'

      return (
        <div className='mt-0.5 flex items-center gap-2'>
          <Chip color={methodColor as any}>{method || 'METHOD'}</Chip>
          <span className='truncate text-foreground text-xs' title={url}>
            {url || 'URL not provided'}
          </span>
        </div>
      )
    }

    if (toolCall.name === 'set_environment_variables') {
      const variables =
        params.variables && typeof params.variables === 'object' ? params.variables : {}
      const entries = Object.entries(variables)
      return (
        <div className='mt-0.5'>
          {entries.length === 0 ? (
            <span className='text-muted-foreground text-xs'>No variables provided</span>
          ) : (
            <div className='space-y-0.5'>
              {entries.map(([k, v]) => (
                <div key={k} className='flex items-center gap-0.5'>
                  <span className='font-medium text-muted-foreground text-xs'>{k}</span>
                  <span className='mx-1 font-medium text-muted-foreground text-xs'>:</span>
                  <span className='truncate font-medium text-foreground text-xs'>{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className='flex w-full flex-col gap-1 py-1'>
      <div
        className={`flex items-center justify-between gap-2 ${
          isExpandableTool ? 'cursor-pointer' : ''
        }`}
        onClick={() => {
          if (isExpandableTool) setExpanded((e) => !e)
        }}
      >
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

                  // Notify the backend about background state with execution start time if available
                  const executionStartTime = context?.executionStartTime
                  await notifyServerTool(
                    toolCall.id,
                    toolCall.name,
                    'background',
                    executionStartTime
                  )

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

      {isExpandableTool && expanded && <div className='pr-1 pl-5'>{renderPendingDetails()}</div>}
    </div>
  )
}
