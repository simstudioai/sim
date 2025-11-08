'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import useDrivePicker from 'react-google-drive-picker'
import { Button } from '@/components/emcn'
import { GoogleDriveIcon } from '@/components/icons'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { getRegisteredTools } from '@/lib/copilot/tools/client/registry'
import { getEnv } from '@/lib/env'
import { CLASS_TOOL_METADATA, useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { CopilotToolCall } from '@/stores/panel-new/copilot/types'

interface InlineToolCallProps {
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
  'Designing',
  'Designed',
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

  // Special tools: use gradient for entire text
  if (isSpecial) {
    const baseTextStyle = {
      backgroundImage: 'linear-gradient(90deg, #B99FFD 0%, #D1BFFF 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    }

    return (
      <span className={`relative inline-block ${className || ''}`}>
        <span style={baseTextStyle}>{text}</span>
        {active ? (
          <span
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 select-none overflow-hidden'
          >
            <span
              className='block text-transparent'
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(142,76,251,0) 0%, rgba(255,255,255,0.6) 50%, rgba(142,76,251,0) 100%)',
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

  // Normal tools: two-tone rendering with lighter action verb
  return (
    <span className={`relative inline-block ${className || ''}`}>
      {actionVerb ? (
        <>
          <span style={{ color: '#B8B8B8' }}>{actionVerb}</span>
          <span style={{ color: '#787878' }}>{remainder}</span>
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
 * Only workflow operation tools (edit, build, run) get the purple gradient.
 */
function isSpecialToolCall(toolCall: CopilotToolCall): boolean {
  const workflowOperationTools = ['edit_workflow', 'build_workflow', 'run_workflow']

  return workflowOperationTools.includes(toolCall.name)
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
  return hasInterrupt && toolCall.state === 'pending'
}

async function handleRun(toolCall: CopilotToolCall, setToolCallState: any, onStateChange?: any) {
  const instance = getClientTool(toolCall.id)
  if (!instance) return
  try {
    const mergedParams =
      (toolCall as any).params || (toolCall as any).parameters || (toolCall as any).input || {}
    await instance.handleAccept?.(mergedParams)
    onStateChange?.('executing')
  } catch (e) {
    setToolCallState(toolCall, 'errored', { error: e instanceof Error ? e.message : String(e) })
  }
}

async function handleSkip(toolCall: CopilotToolCall, setToolCallState: any, onStateChange?: any) {
  const instance = getClientTool(toolCall.id)
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
  return toolCall.name
}

function RunSkipButtons({
  toolCall,
  onStateChange,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const { setToolCallState } = useCopilotStore()
  const [openPicker] = useDrivePicker()

  const instance = getClientTool(toolCall.id)
  const interruptDisplays = instance?.getInterruptDisplays?.()
  const acceptLabel = interruptDisplays?.accept?.text || 'Run'
  const rejectLabel = interruptDisplays?.reject?.text || 'Skip'

  const onRun = async () => {
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await handleRun(toolCall, setToolCallState, onStateChange)
    } finally {
      setIsProcessing(false)
    }
  }

  // const handleOpenDriveAccess = async () => {
  //   try {
  //     const providerId = 'google-drive'
  //     const credsRes = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)
  //     if (!credsRes.ok) return
  //     const credsData = await credsRes.json()
  //     const creds = Array.isArray(credsData.credentials) ? credsData.credentials : []
  //     if (creds.length === 0) return
  //     const defaultCred = creds.find((c: any) => c.isDefault) || creds[0]

  //     const tokenRes = await fetch('/api/auth/oauth/token', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ credentialId: defaultCred.id }),
  //     })
  //     if (!tokenRes.ok) return
  //     const { accessToken } = await tokenRes.json()
  //     if (!accessToken) return

  //     const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
  //     const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''
  //     const projectNumber = getEnv('NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER') || ''

  //     openPicker({
  //       clientId,
  //       developerKey: apiKey,
  //       viewId: 'DOCS',
  //       token: accessToken,
  //       showUploadView: true,
  //       showUploadFolders: true,
  //       supportDrives: true,
  //       multiselect: false,
  //       appId: projectNumber,
  //       setSelectFolderEnabled: false,
  //       callbackFunction: async (data) => {
  //         if (data.action === 'picked') {
  //           await onRun()
  //         }
  //       },
  //     })
  //   } catch {}
  // }

  if (buttonsHidden) return null

  if (toolCall.name === 'gdrive_request_access' && toolCall.state === 'pending') {
    return (
      <div className='mt-[10px] flex gap-[6px]'>
        <Button
          onClick={async () => {
            const instance = getClientTool(toolCall.id)
            if (!instance) return
            await instance.handleAccept?.({
              openDrivePicker: async (accessToken: string) => {
                try {
                  const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
                  const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''
                  const projectNumber = getEnv('NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER') || ''
                  return await new Promise<boolean>((resolve) => {
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
                        if (data.action === 'picked') resolve(true)
                        else if (data.action === 'cancel') resolve(false)
                      },
                    })
                  })
                } catch {
                  return false
                }
              },
            })
          }}
          variant='primary'
          title='Grant Google Drive access'
        >
          <GoogleDriveIcon className='mr-0.5 h-4 w-4' />
          Select
        </Button>
        <Button
          onClick={async () => {
            setButtonsHidden(true)
            await handleSkip(toolCall, setToolCallState, onStateChange)
          }}
          variant='default'
        >
          Skip
        </Button>
      </div>
    )
  }

  return (
    <div className='mt-[12px] flex gap-[6px]'>
      <Button onClick={onRun} disabled={isProcessing} variant='primary'>
        {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
        {acceptLabel}
      </Button>
      <Button
        onClick={async () => {
          setButtonsHidden(true)
          await handleSkip(toolCall, setToolCallState, onStateChange)
        }}
        disabled={isProcessing}
        variant='default'
      >
        {rejectLabel}
      </Button>
    </div>
  )
}

export function InlineToolCall({
  toolCall: toolCallProp,
  toolCallId,
  onStateChange,
}: InlineToolCallProps) {
  const [, forceUpdate] = useState({})
  const liveToolCall = useCopilotStore((s) =>
    toolCallId ? s.toolCallsById[toolCallId] : undefined
  )
  const toolCall = liveToolCall || toolCallProp

  const isExpandablePending =
    toolCall?.state === 'pending' &&
    (toolCall.name === 'make_api_request' || toolCall.name === 'set_global_workflow_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)

  // Guard: nothing to render without a toolCall
  if (!toolCall) return null

  // Skip rendering tools that are not in the registry or are explicitly omitted
  try {
    if (toolCall.name === 'checkoff_todo' || toolCall.name === 'mark_todo_in_progress') return null
    // Allow if tool id exists in CLASS_TOOL_METADATA (client tools)
    if (!CLASS_TOOL_METADATA[toolCall.name]) return null
  } catch {
    return null
  }
  const isExpandableTool =
    toolCall.name === 'make_api_request' || toolCall.name === 'set_global_workflow_variables'

  const showButtons = shouldShowRunSkipButtons(toolCall)
  const showMoveToBackground =
    toolCall.name === 'run_workflow' &&
    (toolCall.state === (ClientToolCallState.executing as any) ||
      toolCall.state === ('executing' as any))

  const handleStateChange = (state: any) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)
  const params = (toolCall as any).parameters || (toolCall as any).input || toolCall.params || {}

  const isLoadingState =
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

  const isSpecial = isSpecialToolCall(toolCall)

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = params.url || ''
      const method = (params.method || '').toUpperCase()
      return (
        <div className='w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-2 gap-0 border-muted/60 border-b bg-muted/40 py-1.5'>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[10px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Method
            </div>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[10px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Endpoint
            </div>
          </div>
          <div className='grid grid-cols-[auto_1fr] gap-2 py-1.5'>
            <div className='self-start px-2'>
              <span className='inline-flex rounded bg-muted px-1.5 py-0.5 font-[470] font-mono text-[#707070] text-xs dark:text-[#E8E8E8]'>
                {method || 'GET'}
              </span>
            </div>
            <div className='min-w-0 self-start px-2'>
              <span
                className='block overflow-x-auto whitespace-nowrap font-[470] font-mono text-[#707070] text-xs dark:text-[#E8E8E8]'
                title={url}
              >
                {url || 'URL not provided'}
              </span>
            </div>
          </div>
        </div>
      )
    }

    if (toolCall.name === 'set_environment_variables') {
      const variables =
        params.variables && typeof params.variables === 'object' ? params.variables : {}

      // Normalize variables - handle both direct key-value and nested {name, value} format
      const normalizedEntries: Array<[string, string]> = []
      Object.entries(variables).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'name' in value && 'value' in value) {
          // Handle {name: "key", value: "val"} format
          normalizedEntries.push([String((value as any).name), String((value as any).value)])
        } else {
          // Handle direct key-value format
          normalizedEntries.push([key, String(value)])
        }
      })

      return (
        <div className='w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-[160px_1fr] gap-0 border-muted/60 border-b bg-muted/40 py-1.5'>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[11px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Name
            </div>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[11px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Value
            </div>
          </div>
          {normalizedEntries.length === 0 ? (
            <div className='px-2 py-1.5 font-[470] font-season text-[#707070] text-xs dark:text-[#E8E8E8]'>
              No variables provided
            </div>
          ) : (
            <div className='divide-y divide-muted/60'>
              {normalizedEntries.map(([name, value]) => (
                <div key={name} className='grid grid-cols-[160px_1fr] gap-0 py-1.5'>
                  <div className='self-start px-2 font-medium font-season text-amber-800 text-xs dark:text-amber-200'>
                    {name}
                  </div>
                  <div className='min-w-0 self-start overflow-x-auto px-2'>
                    <span className='whitespace-nowrap font-[470] font-mono text-amber-700 text-xs dark:text-amber-300'>
                      {value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (toolCall.name === 'set_global_workflow_variables') {
      const ops = Array.isArray(params.operations) ? (params.operations as any[]) : []
      return (
        <div className='w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-3 gap-0 border-muted/60 border-b bg-muted/40 py-1.5'>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[10px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Name
            </div>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[10px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Type
            </div>
            <div className='self-start px-2 font-medium font-season text-[#858585] text-[10px] uppercase tracking-wide dark:text-[#E0E0E0]'>
              Value
            </div>
          </div>
          {ops.length === 0 ? (
            <div className='px-2 py-2 font-[470] font-season text-[#707070] text-xs dark:text-[#E8E8E8]'>
              No operations provided
            </div>
          ) : (
            <div className='divide-y divide-amber-200 dark:divide-amber-800'>
              {ops.map((op, idx) => (
                <div key={idx} className='grid grid-cols-3 gap-0 py-1.5'>
                  <div className='min-w-0 self-start px-2'>
                    <span className='truncate font-season text-amber-800 text-xs dark:text-amber-200'>
                      {String(op.name || '')}
                    </span>
                  </div>
                  <div className='self-start px-2'>
                    <span className='rounded border px-1 py-0.5 font-[470] font-season text-[#707070] text-[10px] dark:text-[#E8E8E8]'>
                      {String(op.type || '')}
                    </span>
                  </div>
                  <div className='min-w-0 self-start px-2'>
                    {op.value !== undefined ? (
                      <span className='block overflow-x-auto whitespace-nowrap font-[470] font-mono text-amber-700 text-xs dark:text-amber-300'>
                        {String(op.value)}
                      </span>
                    ) : (
                      <span className='font-[470] font-season text-[#707070] text-xs dark:text-[#E8E8E8]'>
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

    return null
  }

  // Special handling for set_environment_variables - always stacked, always expanded
  if (toolCall.name === 'set_environment_variables' && toolCall.state === 'pending') {
    return (
      <div className='w-full'>
        <ShimmerOverlayText
          text={displayName}
          active={isLoadingState}
          isSpecial={isSpecial}
          className='font-[470] font-season text-[#939393] text-sm dark:text-[#939393]'
        />
        <div className='mt-[8px]'>{renderPendingDetails()}</div>
        {showButtons && <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} />}
      </div>
    )
  }

  return (
    <div className='w-full'>
      <div
        className={isExpandableTool ? 'cursor-pointer' : ''}
        onClick={() => {
          if (isExpandableTool) setExpanded((e) => !e)
        }}
      >
        <ShimmerOverlayText
          text={displayName}
          active={isLoadingState}
          isSpecial={isSpecial}
          className='font-[470] font-season text-[#939393] text-sm dark:text-[#939393]'
        />
      </div>
      {isExpandableTool && expanded && <div>{renderPendingDetails()}</div>}
      {showButtons ? (
        <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} />
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
            variant='primary'
            title='Move to Background'
          >
            Move to Background
          </Button>
        </div>
      ) : null}
    </div>
  )
}
