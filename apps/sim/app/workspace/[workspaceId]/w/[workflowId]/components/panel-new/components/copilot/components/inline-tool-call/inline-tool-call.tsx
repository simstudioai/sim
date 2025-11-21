'use client'

import { useEffect, useRef, useState } from 'react'
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

async function handleRun(
  toolCall: CopilotToolCall,
  setToolCallState: any,
  onStateChange?: any,
  editedParams?: any
) {
  const instance = getClientTool(toolCall.id)
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
  editedParams,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
  editedParams?: any
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
      await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
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

  // Guard: nothing to render without a toolCall
  if (!toolCall) return null

  const isExpandablePending =
    toolCall?.state === 'pending' &&
    (toolCall.name === 'make_api_request' ||
      toolCall.name === 'set_global_workflow_variables' ||
      toolCall.name === 'run_workflow')

  const [expanded, setExpanded] = useState(isExpandablePending)

  // State for editable parameters
  const params = (toolCall as any).parameters || (toolCall as any).input || toolCall.params || {}
  const [editedParams, setEditedParams] = useState(params)
  const paramsRef = useRef(params)

  // Update edited params when toolCall params change (deep comparison to avoid resetting user edits on ref change)
  useEffect(() => {
    if (JSON.stringify(params) !== JSON.stringify(paramsRef.current)) {
      setEditedParams(params)
      paramsRef.current = params
    }
  }, [params])

  // Skip rendering tools that are not in the registry or are explicitly omitted
  try {
    if (toolCall.name === 'checkoff_todo' || toolCall.name === 'mark_todo_in_progress') return null
    // Allow if tool id exists in CLASS_TOOL_METADATA (client tools)
    if (!CLASS_TOOL_METADATA[toolCall.name]) return null
  } catch {
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
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-strong)] border-b bg-transparent'>
                <th className='w-[26%] border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Method
                </th>
                <th className='w-[74%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Endpoint
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              <tr className='group relative border-[var(--border-strong)] border-t bg-transparent'>
                <td className='relative w-[26%] border-[var(--border-strong)] border-r bg-transparent p-0'>
                  <div className='px-[10px] py-[8px]'>
                    <input
                      type='text'
                      value={method || 'GET'}
                      onChange={(e) =>
                        setEditedParams({ ...editedParams, method: e.target.value })
                      }
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
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-strong)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Name
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {normalizedEntries.length === 0 ? (
                <tr className='border-[var(--border-strong)] border-t bg-transparent'>
                  <td colSpan={2} className='px-[10px] py-[8px] text-muted-foreground text-xs'>
                    No variables provided
                  </td>
                </tr>
              ) : (
                normalizedEntries.map(([originalKey, name, value]) => (
                  <tr
                    key={originalKey}
                    className='group relative border-[var(--border-strong)] border-t bg-transparent'
                  >
                    <td className='relative w-[36%] border-[var(--border-strong)] border-r bg-transparent p-0'>
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
                              if (
                                typeof item === 'object' &&
                                item !== null &&
                                'name' in item
                              ) {
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
                          className='w-full bg-transparent font-medium text-foreground text-xs outline-none'
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

                            const currentVal = newVariables[originalKey as keyof typeof newVariables]

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
                          className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
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
                    <input
                      type='text'
                      value={String(op.name || '')}
                      onChange={(e) => {
                        const newOps = [...ops]
                        newOps[idx] = { ...op, name: e.target.value }
                        setEditedParams({ ...editedParams, operations: newOps })
                      }}
                      className='w-full bg-transparent font-season text-amber-800 text-xs outline-none dark:text-amber-200'
                    />
                  </div>
                  <div className='self-start px-2'>
                    <span className='rounded border px-1 py-0.5 font-[470] font-season text-[#707070] text-[10px] dark:text-[#E8E8E8]'>
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
                        className='w-full bg-transparent font-[470] font-mono text-amber-700 text-xs outline-none focus:text-amber-800 dark:text-amber-300 dark:focus:text-amber-200'
                      />
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
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-strong)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Input
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {inputEntries.length === 0 ? (
                <tr className='border-[var(--border-strong)] border-t bg-transparent'>
                  <td colSpan={2} className='px-[10px] py-[8px] text-muted-foreground text-xs'>
                    No inputs provided
                  </td>
                </tr>
              ) : (
                inputEntries.map(([key, value]) => (
                  <tr
                    key={key}
                    className='group relative border-[var(--border-strong)] border-t bg-transparent'
                  >
                    <td className='relative w-[36%] border-[var(--border-strong)] border-r bg-transparent p-0'>
                      <div className='px-[10px] py-[8px]'>
                        <span className='truncate font-medium text-foreground text-xs'>{key}</span>
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
                            } else if (editedParams.input && typeof editedParams.input === 'object') {
                              // Input is an object
                              setEditedParams({ ...editedParams, input: newInputs })
                            } else if (editedParams.inputs && typeof editedParams.inputs === 'object') {
                              // Inputs is an object
                              setEditedParams({ ...editedParams, inputs: newInputs })
                            } else {
                              // Flat structure - update at base level
                              setEditedParams({ ...editedParams, [key]: e.target.value })
                            }
                          }}
                          className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
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
    return (
      <div className='w-full'>
        <ShimmerOverlayText
          text={displayName}
          active={isLoadingState}
          isSpecial={isSpecial}
          className='font-[470] font-season text-[#939393] text-sm dark:text-[#939393]'
        />
        <div className='mt-[8px]'>{renderPendingDetails()}</div>
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
