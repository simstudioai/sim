'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Code } from '@/components/emcn'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { getRegisteredTools } from '@/lib/copilot/tools/client/registry'
import type { CopilotToolCall } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'
import { CLASS_TOOL_METADATA } from '@/stores/panel/copilot/store'

interface ToolCallProps {
  toolCall?: CopilotToolCall
  toolCallId?: string
  onStateChange?: (state: any) => void
}

/**
 * Props for shimmer overlay text component.
 */
interface ShimmerOverlayTextProps {
  /** The text content to display */
  text: string
  /** Whether the shimmer animation is active */
  active?: boolean
  /** Additional class names for the wrapper */
  className?: string
  /** Whether to use special gradient styling (for important actions) */
  isSpecial?: boolean
}

/**
 * Action verbs that appear at the start of tool display names.
 * These will be highlighted in a lighter color for better visual hierarchy.
 */
const ACTION_VERBS = [
  'Analyzing',
  'Analyzed',
  'Exploring',
  'Explored',
  'Fetching',
  'Fetched',
  'Retrieved',
  'Retrieving',
  'Reading',
  'Read',
  'Listing',
  'Listed',
  'Editing',
  'Edited',
  'Running',
  'Ran',
  'Designing',
  'Designed',
  'Searching',
  'Searched',
  'Debugging',
  'Debugged',
  'Validating',
  'Validated',
  'Adjusting',
  'Adjusted',
  'Summarizing',
  'Summarized',
  'Marking',
  'Marked',
  'Planning',
  'Planned',
  'Preparing',
  'Failed',
  'Aborted',
  'Skipped',
  'Review',
  'Finding',
  'Found',
  'Evaluating',
  'Evaluated',
  'Finished',
  'Setting',
  'Set',
  'Applied',
  'Applying',
  'Rejected',
  'Deploy',
  'Deploying',
  'Deployed',
  'Redeploying',
  'Redeployed',
  'Redeploy',
  'Undeploy',
  'Undeploying',
  'Undeployed',
  'Checking',
  'Checked',
  'Opening',
  'Opened',
  'Create',
  'Creating',
  'Created',
  'Generating',
  'Generated',
  'Rendering',
  'Rendered',
  'Sleeping',
  'Slept',
  'Resumed',
] as const

/**
 * Splits text into action verb and remainder for two-tone rendering.
 * Returns [actionVerb, remainder] or [null, text] if no match.
 */
function splitActionVerb(text: string): [string | null, string] {
  for (const verb of ACTION_VERBS) {
    if (text.startsWith(`${verb} `)) {
      return [verb, text.slice(verb.length)]
    }
    // Handle cases like "Review your workflow changes" where verb is the only word before "your"
    if (text === verb || text.startsWith(verb)) {
      // Check if it's followed by a space or is the whole text
      const afterVerb = text.slice(verb.length)
      if (afterVerb === '' || afterVerb.startsWith(' ')) {
        return [verb, afterVerb]
      }
    }
  }
  return [null, text]
}

/**
 * Renders text with a subtle white shimmer overlay when active, creating a skeleton-like
 * loading effect that passes over the existing words without replacing them.
 * For special tool calls, uses a gradient color. For normal tools, highlights action verbs
 * in a lighter color with the rest in default gray.
 */
function ShimmerOverlayText({
  text,
  active = false,
  className,
  isSpecial = false,
}: ShimmerOverlayTextProps) {
  const [actionVerb, remainder] = splitActionVerb(text)

  // Special tools: use tertiary-2 color for entire text with shimmer
  if (isSpecial) {
    return (
      <span className={`relative inline-block ${className || ''}`}>
        <span className='text-[var(--brand-tertiary-2)]'>{text}</span>
        {active ? (
          <span
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 select-none overflow-hidden'
          >
            <span
              className='block text-transparent'
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(51,196,129,0) 0%, rgba(255,255,255,0.6) 50%, rgba(51,196,129,0) 100%)',
                backgroundSize: '200% 100%',
                backgroundRepeat: 'no-repeat',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
                mixBlendMode: 'screen',
              }}
            >
              {text}
            </span>
          </span>
        ) : null}
        <style>{`
          @keyframes toolcall-shimmer {
            0% { background-position: 150% 0; }
            50% { background-position: 0% 0; }
            100% { background-position: -150% 0; }
          }
        `}</style>
      </span>
    )
  }

  // Normal tools: two-tone rendering - action verb darker in light mode, lighter in dark mode
  return (
    <span className={`relative inline-block ${className || ''}`}>
      {actionVerb ? (
        <>
          <span className='text-[var(--text-primary)] dark:text-[var(--text-tertiary)]'>
            {actionVerb}
          </span>
          <span className='text-[var(--text-secondary)] dark:text-[var(--text-muted)]'>
            {remainder}
          </span>
        </>
      ) : (
        <span>{text}</span>
      )}
      {active ? (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 select-none overflow-hidden'
        >
          <span
            className='block text-transparent'
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
              mixBlendMode: 'screen',
            }}
          >
            {text}
          </span>
        </span>
      ) : null}
      <style>{`
        @keyframes toolcall-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>
    </span>
  )
}

/**
 * Determines if a tool call is "special" and should display with gradient styling.
 * Only workflow operation tools (edit, build, run, deploy) get the purple gradient.
 */
function isSpecialToolCall(toolCall: CopilotToolCall): boolean {
  const workflowOperationTools = [
    'edit_workflow',
    'build_workflow',
    'run_workflow',
    'deploy_workflow',
  ]

  return workflowOperationTools.includes(toolCall.name)
}

/**
 * Checks if a tool is an integration tool (server-side executed, not a client tool)
 */
function isIntegrationTool(toolName: string): boolean {
  // Check if it's NOT a client tool (not in CLASS_TOOL_METADATA and not in registered tools)
  const isClientTool = !!CLASS_TOOL_METADATA[toolName]
  const isRegisteredTool = !!getRegisteredTools()[toolName]
  return !isClientTool && !isRegisteredTool
}

function shouldShowRunSkipButtons(toolCall: CopilotToolCall): boolean {
  const instance = getClientTool(toolCall.id)
  let hasInterrupt = !!instance?.getInterruptDisplays?.()
  if (!hasInterrupt) {
    try {
      const def = getRegisteredTools()[toolCall.name]
      if (def) {
        hasInterrupt =
          typeof def.hasInterrupt === 'function'
            ? !!def.hasInterrupt(toolCall.params || {})
            : !!def.hasInterrupt
      }
    } catch {}
  }

  // Show buttons for client tools with interrupts
  if (hasInterrupt && toolCall.state === 'pending') {
    return true
  }

  // Also show buttons for integration tools in pending state (they need user confirmation)
  // But NOT if the tool is auto-allowed (it will auto-execute)
  const mode = useCopilotStore.getState().mode
  const isAutoAllowed = useCopilotStore.getState().isToolAutoAllowed(toolCall.name)
  if (
    mode === 'build' &&
    isIntegrationTool(toolCall.name) &&
    toolCall.state === 'pending' &&
    !isAutoAllowed
  ) {
    return true
  }

  return false
}

async function handleRun(
  toolCall: CopilotToolCall,
  setToolCallState: any,
  onStateChange?: any,
  editedParams?: any
) {
  const instance = getClientTool(toolCall.id)

  // Handle integration tools (server-side execution)
  if (!instance && isIntegrationTool(toolCall.name)) {
    // Set executing state immediately for UI feedback
    setToolCallState(toolCall, 'executing')
    onStateChange?.('executing')
    try {
      await useCopilotStore.getState().executeIntegrationTool(toolCall.id)
      // Note: executeIntegrationTool handles success/error state updates internally
    } catch (e) {
      // If executeIntegrationTool throws, ensure we update state to error
      setToolCallState(toolCall, 'error', { error: e instanceof Error ? e.message : String(e) })
      onStateChange?.('error')
      // Notify backend about the error so agent doesn't hang
      try {
        await fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: toolCall.id,
            name: toolCall.name,
            status: 500,
            message: e instanceof Error ? e.message : 'Tool execution failed',
            data: { error: e instanceof Error ? e.message : String(e) },
          }),
        })
      } catch {
        // Last resort: log error if we can't notify backend
        console.error('[handleRun] Failed to notify backend of tool error:', toolCall.id)
      }
    }
    return
  }

  if (!instance) return
  try {
    const mergedParams =
      editedParams ||
      (toolCall as any).params ||
      (toolCall as any).parameters ||
      (toolCall as any).input ||
      {}
    await instance.handleAccept?.(mergedParams)
    onStateChange?.('executing')
  } catch (e) {
    setToolCallState(toolCall, 'error', { error: e instanceof Error ? e.message : String(e) })
  }
}

async function handleSkip(toolCall: CopilotToolCall, setToolCallState: any, onStateChange?: any) {
  const instance = getClientTool(toolCall.id)

  // Handle integration tools (skip by marking as rejected and notifying backend)
  if (!instance && isIntegrationTool(toolCall.name)) {
    setToolCallState(toolCall, 'rejected')
    onStateChange?.('rejected')

    // Notify backend that tool was skipped - this is CRITICAL for the agent to continue
    // Retry up to 3 times if the notification fails
    let notified = false
    for (let attempt = 0; attempt < 3 && !notified; attempt++) {
      try {
        const res = await fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: toolCall.id,
            name: toolCall.name,
            status: 400,
            message: 'Tool execution skipped by user',
            data: { skipped: true, reason: 'user_skipped' },
          }),
        })
        if (res.ok) {
          notified = true
        }
      } catch (e) {
        // Wait briefly before retry
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }

    if (!notified) {
      console.error('[handleSkip] Failed to notify backend after 3 attempts:', toolCall.id)
    }
    return
  }

  if (instance) {
    try {
      await instance.handleReject?.()
    } catch {}
  }
  setToolCallState(toolCall, 'rejected')
  onStateChange?.('rejected')
}

function getDisplayName(toolCall: CopilotToolCall): string {
  // Prefer display resolved in the copilot store (SSOT)
  const fromStore = (toolCall as any).display?.text
  if (fromStore) return fromStore
  try {
    const def = getRegisteredTools()[toolCall.name] as any
    const byState = def?.metadata?.displayNames?.[toolCall.state]
    if (byState?.text) return byState.text
  } catch {}

  // For integration tools, format the tool name nicely
  // e.g., "google_calendar_list_events" -> "Running Google Calendar List Events"
  const stateVerb = getStateVerb(toolCall.state)
  const formattedName = formatToolName(toolCall.name)
  return `${stateVerb} ${formattedName}`
}

/**
 * Get verb prefix based on tool state
 */
function getStateVerb(state: string): string {
  switch (state) {
    case 'pending':
    case 'executing':
      return 'Running'
    case 'success':
      return 'Ran'
    case 'error':
      return 'Failed'
    case 'rejected':
    case 'aborted':
      return 'Skipped'
    default:
      return 'Running'
  }
}

/**
 * Format tool name for display
 * e.g., "google_calendar_list_events" -> "Google Calendar List Events"
 */
function formatToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function RunSkipButtons({
  toolCall,
  onStateChange,
  editedParams,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
  editedParams?: any
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const actionInProgressRef = useRef(false)
  const { setToolCallState, addAutoAllowedTool } = useCopilotStore()

  const onRun = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  const onAlwaysAllow = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      // Add to auto-allowed list first
      await addAutoAllowedTool(toolCall.name)
      // Then execute
      await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  const onSkip = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await handleSkip(toolCall, setToolCallState, onStateChange)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  if (buttonsHidden) return null

  // Standardized buttons for all interrupt tools: Allow, Always Allow, Skip
  return (
    <div className='mt-[12px] flex gap-[6px]'>
      <Button onClick={onRun} disabled={isProcessing} variant='tertiary'>
        {isProcessing ? 'Allowing...' : 'Allow'}
      </Button>
      <Button onClick={onAlwaysAllow} disabled={isProcessing} variant='default'>
        {isProcessing ? 'Allowing...' : 'Always Allow'}
      </Button>
      <Button onClick={onSkip} disabled={isProcessing} variant='default'>
        Skip
      </Button>
    </div>
  )
}

export function ToolCall({ toolCall: toolCallProp, toolCallId, onStateChange }: ToolCallProps) {
  const [, forceUpdate] = useState({})
  const liveToolCall = useCopilotStore((s) =>
    toolCallId ? s.toolCallsById[toolCallId] : undefined
  )
  const toolCall = liveToolCall || toolCallProp

  // Guard: nothing to render without a toolCall
  if (!toolCall) return null

  const isExpandablePending =
    toolCall?.state === 'pending' &&
    (toolCall.name === 'make_api_request' ||
      toolCall.name === 'set_global_workflow_variables' ||
      toolCall.name === 'run_workflow')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const [showRemoveAutoAllow, setShowRemoveAutoAllow] = useState(false)

  // State for editable parameters
  const params = (toolCall as any).parameters || (toolCall as any).input || toolCall.params || {}
  const [editedParams, setEditedParams] = useState(params)
  const paramsRef = useRef(params)

  // Check if this integration tool is auto-allowed
  // Subscribe to autoAllowedTools so we re-render when it changes
  const autoAllowedTools = useCopilotStore((s) => s.autoAllowedTools)
  const { removeAutoAllowedTool } = useCopilotStore()
  const isAutoAllowed = isIntegrationTool(toolCall.name) && autoAllowedTools.includes(toolCall.name)

  // Update edited params when toolCall params change (deep comparison to avoid resetting user edits on ref change)
  useEffect(() => {
    if (JSON.stringify(params) !== JSON.stringify(paramsRef.current)) {
      setEditedParams(params)
      paramsRef.current = params
    }
  }, [params])

  // Skip rendering some internal tools
  if (toolCall.name === 'checkoff_todo' || toolCall.name === 'mark_todo_in_progress') return null

  // Get current mode from store to determine if we should render integration tools
  const mode = useCopilotStore.getState().mode

  // Allow rendering if:
  // 1. Tool is in CLASS_TOOL_METADATA (client tools), OR
  // 2. We're in build mode (integration tools are executed server-side)
  const isClientTool = !!CLASS_TOOL_METADATA[toolCall.name]
  const isIntegrationToolInBuildMode = mode === 'build' && !isClientTool

  if (!isClientTool && !isIntegrationToolInBuildMode) {
    return null
  }
  const isExpandableTool =
    toolCall.name === 'make_api_request' ||
    toolCall.name === 'set_global_workflow_variables' ||
    toolCall.name === 'run_workflow'

  const showButtons = shouldShowRunSkipButtons(toolCall)
  const showMoveToBackground =
    toolCall.name === 'run_workflow' &&
    (toolCall.state === (ClientToolCallState.executing as any) ||
      toolCall.state === ('executing' as any))

  const showWake =
    toolCall.name === 'sleep' &&
    (toolCall.state === (ClientToolCallState.executing as any) ||
      toolCall.state === ('executing' as any))

  const handleStateChange = (state: any) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)

  const isLoadingState =
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

  const isSpecial = isSpecialToolCall(toolCall)

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = editedParams.url || ''
      const method = (editedParams.method || '').toUpperCase()
      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[26%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Method
                </th>
                <th className='w-[74%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Endpoint
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              <tr className='group relative border-[var(--border-1)] border-t bg-transparent'>
                <td className='relative w-[26%] border-[var(--border-1)] border-r bg-transparent p-0'>
                  <div className='px-[10px] py-[8px]'>
                    <input
                      type='text'
                      value={method || 'GET'}
                      onChange={(e) => setEditedParams({ ...editedParams, method: e.target.value })}
                      className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
                    />
                  </div>
                </td>
                <td className='relative w-[74%] bg-transparent p-0'>
                  <div className='min-w-0 px-[10px] py-[8px]'>
                    <input
                      type='text'
                      value={url || ''}
                      onChange={(e) => setEditedParams({ ...editedParams, url: e.target.value })}
                      placeholder='URL not provided'
                      className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    }

    if (toolCall.name === 'set_environment_variables') {
      const variables =
        editedParams.variables && typeof editedParams.variables === 'object'
          ? editedParams.variables
          : {}

      // Normalize variables - handle both direct key-value and nested {name, value} format
      // Store [originalKey, displayName, displayValue]
      const normalizedEntries: Array<[string, string, string]> = []
      Object.entries(variables).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'name' in value && 'value' in value) {
          // Handle { name: "KEY", value: "VAL" } format (common in arrays or structured objects)
          normalizedEntries.push([key, String((value as any).name), String((value as any).value)])
        } else {
          // Handle direct key-value format
          normalizedEntries.push([key, key, String(value)])
        }
      })

      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Name
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {normalizedEntries.length === 0 ? (
                <tr className='border-[var(--border-1)] border-t bg-transparent'>
                  <td colSpan={2} className='px-[10px] py-[8px] text-[var(--text-muted)] text-xs'>
                    No variables provided
                  </td>
                </tr>
              ) : (
                normalizedEntries.map(([originalKey, name, value]) => (
                  <tr
                    key={originalKey}
                    className='group relative border-[var(--border-1)] border-t bg-transparent'
                  >
                    <td className='relative w-[36%] border-[var(--border-1)] border-r bg-transparent p-0'>
                      <div className='px-[10px] py-[8px]'>
                        <input
                          type='text'
                          value={name}
                          onChange={(e) => {
                            const newName = e.target.value
                            const newVariables = Array.isArray(variables)
                              ? [...variables]
                              : { ...variables }

                            if (Array.isArray(newVariables)) {
                              // Array format: update .name property
                              const idx = Number(originalKey)
                              const item = newVariables[idx]
                              if (typeof item === 'object' && item !== null && 'name' in item) {
                                newVariables[idx] = { ...item, name: newName }
                              }
                            } else {
                              // Object format: rename key
                              // We need to preserve the value but change the key
                              const value = newVariables[originalKey as keyof typeof newVariables]
                              delete newVariables[originalKey as keyof typeof newVariables]
                              newVariables[newName as keyof typeof newVariables] = value
                            }
                            setEditedParams({ ...editedParams, variables: newVariables })
                          }}
                          className='w-full bg-transparent font-medium text-[var(--text-primary)] text-xs outline-none'
                        />
                      </div>
                    </td>
                    <td className='relative w-[64%] bg-transparent p-0'>
                      <div className='min-w-0 px-[10px] py-[8px]'>
                        <input
                          type='text'
                          value={value}
                          onChange={(e) => {
                            // Clone the variables container (works for both Array and Object)
                            const newVariables = Array.isArray(variables)
                              ? [...variables]
                              : { ...variables }

                            const currentVal =
                              newVariables[originalKey as keyof typeof newVariables]

                            if (
                              typeof currentVal === 'object' &&
                              currentVal !== null &&
                              'value' in currentVal
                            ) {
                              // Update value in object structure
                              newVariables[originalKey as keyof typeof newVariables] = {
                                ...(currentVal as any),
                                value: e.target.value,
                              }
                            } else {
                              // Update direct value
                              newVariables[originalKey as keyof typeof newVariables] = e.target
                                .value as any
                            }
                            setEditedParams({ ...editedParams, variables: newVariables })
                          }}
                          className='w-full bg-transparent font-mono text-[var(--text-muted)] text-xs outline-none focus:text-[var(--text-primary)]'
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )
    }

    if (toolCall.name === 'set_global_workflow_variables') {
      const ops = Array.isArray(editedParams.operations) ? (editedParams.operations as any[]) : []
      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <div className='grid grid-cols-3 gap-0 border-[var(--border-1)] border-b bg-[var(--surface-4)] py-1.5'>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Name
            </div>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Type
            </div>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Value
            </div>
          </div>
          {ops.length === 0 ? (
            <div className='px-2 py-2 font-[470] font-season text-[var(--text-primary)] text-xs'>
              No operations provided
            </div>
          ) : (
            <div className='divide-y divide-[var(--border-1)]'>
              {ops.map((op, idx) => (
                <div key={idx} className='grid grid-cols-3 gap-0 py-1.5'>
                  <div className='min-w-0 self-start px-2'>
                    <input
                      type='text'
                      value={String(op.name || '')}
                      onChange={(e) => {
                        const newOps = [...ops]
                        newOps[idx] = { ...op, name: e.target.value }
                        setEditedParams({ ...editedParams, operations: newOps })
                      }}
                      className='w-full bg-transparent font-season text-[var(--text-primary)] text-xs outline-none'
                    />
                  </div>
                  <div className='self-start px-2'>
                    <span className='rounded border border-[var(--border-1)] px-1 py-0.5 font-[470] font-season text-[10px] text-[var(--text-primary)]'>
                      {String(op.type || '')}
                    </span>
                  </div>
                  <div className='min-w-0 self-start px-2'>
                    {op.value !== undefined ? (
                      <input
                        type='text'
                        value={String(op.value)}
                        onChange={(e) => {
                          const newOps = [...ops]
                          newOps[idx] = { ...op, value: e.target.value }
                          setEditedParams({ ...editedParams, operations: newOps })
                        }}
                        className='w-full bg-transparent font-[470] font-mono text-[var(--text-muted)] text-xs outline-none focus:text-[var(--text-primary)]'
                      />
                    ) : (
                      <span className='font-[470] font-season text-[var(--text-primary)] text-xs'>
                        —
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (toolCall.name === 'run_workflow') {
      // Get inputs - could be in multiple locations
      let inputs = editedParams.input || editedParams.inputs || editedParams.workflow_input
      let isNestedInWorkflowInput = false

      // If input is a JSON string, parse it
      if (typeof inputs === 'string') {
        try {
          inputs = JSON.parse(inputs)
        } catch {
          inputs = {}
        }
      }

      // Check if workflow_input exists and contains the actual inputs
      if (editedParams.workflow_input && typeof editedParams.workflow_input === 'object') {
        inputs = editedParams.workflow_input
        isNestedInWorkflowInput = true
      }

      // If no inputs object found, treat base editedParams as inputs (excluding system fields)
      if (!inputs || typeof inputs !== 'object') {
        const { workflowId, workflow_input, ...rest } = editedParams
        inputs = rest
      }

      const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
      const inputEntries = Object.entries(safeInputs)

      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Input
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {inputEntries.length === 0 ? (
                <tr className='border-[var(--border-1)] border-t bg-transparent'>
                  <td colSpan={2} className='px-[10px] py-[8px] text-[var(--text-muted)] text-xs'>
                    No inputs provided
                  </td>
                </tr>
              ) : (
                inputEntries.map(([key, value]) => (
                  <tr
                    key={key}
                    className='group relative border-[var(--border-1)] border-t bg-transparent'
                  >
                    <td className='relative w-[36%] border-[var(--border-1)] border-r bg-transparent p-0'>
                      <div className='px-[10px] py-[8px]'>
                        <span className='truncate font-medium text-[var(--text-primary)] text-xs'>
                          {key}
                        </span>
                      </div>
                    </td>
                    <td className='relative w-[64%] bg-transparent p-0'>
                      <div className='min-w-0 px-[10px] py-[8px]'>
                        <input
                          type='text'
                          value={String(value)}
                          onChange={(e) => {
                            const newInputs = { ...safeInputs, [key]: e.target.value }

                            // Determine how to update based on original structure
                            if (isNestedInWorkflowInput) {
                              // Update workflow_input
                              setEditedParams({ ...editedParams, workflow_input: newInputs })
                            } else if (typeof editedParams.input === 'string') {
                              // Input was a JSON string, serialize back
                              setEditedParams({ ...editedParams, input: JSON.stringify(newInputs) })
                            } else if (
                              editedParams.input &&
                              typeof editedParams.input === 'object'
                            ) {
                              // Input is an object
                              setEditedParams({ ...editedParams, input: newInputs })
                            } else if (
                              editedParams.inputs &&
                              typeof editedParams.inputs === 'object'
                            ) {
                              // Inputs is an object
                              setEditedParams({ ...editedParams, inputs: newInputs })
                            } else {
                              // Flat structure - update at base level
                              setEditedParams({ ...editedParams, [key]: e.target.value })
                            }
                          }}
                          className='w-full bg-transparent font-mono text-[var(--text-muted)] text-xs outline-none focus:text-[var(--text-primary)]'
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )
    }

    return null
  }

  // Special handling for set_environment_variables - always stacked, always expanded
  if (toolCall.name === 'set_environment_variables' && toolCall.state === 'pending') {
    const isEnvVarsClickable = isAutoAllowed

    const handleEnvVarsClick = () => {
      if (isAutoAllowed) {
        setShowRemoveAutoAllow((prev) => !prev)
      }
    }

    return (
      <div className='w-full'>
        <div className={isEnvVarsClickable ? 'cursor-pointer' : ''} onClick={handleEnvVarsClick}>
          <ShimmerOverlayText
            text={displayName}
            active={isLoadingState}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
        <div className='mt-[8px]'>{renderPendingDetails()}</div>
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-[8px]'>
            <Button
              onClick={async () => {
                await removeAutoAllowedTool(toolCall.name)
                setShowRemoveAutoAllow(false)
                forceUpdate({})
              }}
              variant='default'
              className='text-xs'
            >
              Remove from Always Allowed
            </Button>
          </div>
        )}
        {showButtons && (
          <RunSkipButtons
            toolCall={toolCall}
            onStateChange={handleStateChange}
            editedParams={editedParams}
          />
        )}
      </div>
    )
  }

  // Special rendering for function_execute - show code block
  if (toolCall.name === 'function_execute') {
    const code = params.code || ''
    const isFunctionExecuteClickable = isAutoAllowed

    const handleFunctionExecuteClick = () => {
      if (isAutoAllowed) {
        setShowRemoveAutoAllow((prev) => !prev)
      }
    }

    return (
      <div className='w-full'>
        <div
          className={isFunctionExecuteClickable ? 'cursor-pointer' : ''}
          onClick={handleFunctionExecuteClick}
        >
          <ShimmerOverlayText
            text={displayName}
            active={isLoadingState}
            isSpecial={false}
            className='font-[470] font-season text-[var(--text-muted)] text-sm'
          />
        </div>
        {code && (
          <div className='mt-2'>
            <Code.Viewer code={code} language='javascript' showGutter className='min-h-0' />
          </div>
        )}
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-[8px]'>
            <Button
              onClick={async () => {
                await removeAutoAllowedTool(toolCall.name)
                setShowRemoveAutoAllow(false)
                forceUpdate({})
              }}
              variant='default'
              className='text-xs'
            >
              Remove from Always Allowed
            </Button>
          </div>
        )}
        {showButtons && (
          <RunSkipButtons
            toolCall={toolCall}
            onStateChange={handleStateChange}
            editedParams={editedParams}
          />
        )}
      </div>
    )
  }

  // Determine if tool name should be clickable (expandable tools or auto-allowed integration tools)
  const isToolNameClickable = isExpandableTool || isAutoAllowed

  const handleToolNameClick = () => {
    if (isExpandableTool) {
      setExpanded((e) => !e)
    } else if (isAutoAllowed) {
      setShowRemoveAutoAllow((prev) => !prev)
    }
  }

  return (
    <div className='w-full'>
      <div className={isToolNameClickable ? 'cursor-pointer' : ''} onClick={handleToolNameClick}>
        <ShimmerOverlayText
          text={displayName}
          active={isLoadingState}
          isSpecial={isSpecial}
          className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
        />
      </div>
      {isExpandableTool && expanded && <div>{renderPendingDetails()}</div>}
      {showRemoveAutoAllow && isAutoAllowed && (
        <div className='mt-[8px]'>
          <Button
            onClick={async () => {
              await removeAutoAllowedTool(toolCall.name)
              setShowRemoveAutoAllow(false)
              forceUpdate({})
            }}
            variant='default'
            className='text-xs'
          >
            Remove from Always Allowed
          </Button>
        </div>
      )}
      {showButtons ? (
        <RunSkipButtons
          toolCall={toolCall}
          onStateChange={handleStateChange}
          editedParams={editedParams}
        />
      ) : showMoveToBackground ? (
        <div className='mt-[8px]'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                // Transition to background state locally so UI updates immediately
                instance?.setState?.((ClientToolCallState as any).background)
                await instance?.markToolComplete?.(
                  200,
                  'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete'
                )
                // Optionally force a re-render; store should sync state from server
                forceUpdate({})
                onStateChange?.('background')
              } catch {}
            }}
            variant='tertiary'
            title='Move to Background'
          >
            Move to Background
          </Button>
        </div>
      ) : showWake ? (
        <div className='mt-[8px]'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                // Get elapsed seconds before waking
                const elapsedSeconds = instance?.getElapsedSeconds?.() || 0
                // Transition to background state locally so UI updates immediately
                // Pass elapsed seconds in the result so dynamic text can use it
                instance?.setState?.((ClientToolCallState as any).background, {
                  result: { _elapsedSeconds: elapsedSeconds },
                })
                // Update the tool call params in the store to include elapsed time for display
                const { updateToolCallParams } = useCopilotStore.getState()
                updateToolCallParams?.(toolCall.id, { _elapsedSeconds: Math.round(elapsedSeconds) })
                await instance?.markToolComplete?.(
                  200,
                  `User woke you up after ${Math.round(elapsedSeconds)} seconds`
                )
                // Optionally force a re-render; store should sync state from server
                forceUpdate({})
                onStateChange?.('background')
              } catch {}
            }}
            variant='tertiary'
            title='Wake'
          >
            Wake
          </Button>
        </div>
      ) : null}
    </div>
  )
}
