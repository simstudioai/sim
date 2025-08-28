'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import useDrivePicker from 'react-google-drive-picker'
import { GoogleDriveIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { getRegisteredTools } from '@/lib/copilot/tools/client/registry'
import { getEnv } from '@/lib/env'
import { CLASS_TOOL_METADATA, useCopilotStore } from '@/stores/copilot/store'
import type { CopilotToolCall } from '@/stores/copilot/types'

interface InlineToolCallProps {
  toolCall?: CopilotToolCall
  toolCallId?: string
  onStateChange?: (state: any) => void
  context?: Record<string, any>
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
            await onRun()
          }
        },
      })
    } catch {}
  }

  if (buttonsHidden) return null

  if (toolCall.name === 'gdrive_request_access' && toolCall.state === 'pending') {
    return (
      <div className='flex items-center gap-2'>
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
            await handleSkip(toolCall, setToolCallState, onStateChange)
          }}
          size='sm'
          className='h-6 bg-gray-200 px-2 font-medium text-gray-700 text-xs hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
        >
          Skip
        </Button>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-1.5'>
      <Button
        onClick={onRun}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-900 px-2 font-medium text-white text-xs hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
      >
        {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
        {acceptLabel}
      </Button>
      <Button
        onClick={async () => {
          setButtonsHidden(true)
          await handleSkip(toolCall, setToolCallState, onStateChange)
        }}
        disabled={isProcessing}
        size='sm'
        className='h-6 bg-gray-200 px-2 font-medium text-gray-700 text-xs hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
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
  context,
}: InlineToolCallProps) {
  const [, forceUpdate] = useState({})
  const liveToolCall = useCopilotStore((s) =>
    toolCallId ? s.toolCallsById[toolCallId] : undefined
  )
  const toolCall = liveToolCall || toolCallProp

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

  const isExpandablePending =
    toolCall.state === 'pending' &&
    (toolCall.name === 'make_api_request' ||
      toolCall.name === 'set_environment_variables' ||
      toolCall.name === 'set_global_workflow_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const isExpandableTool =
    toolCall.name === 'make_api_request' ||
    toolCall.name === 'set_environment_variables' ||
    toolCall.name === 'set_global_workflow_variables'

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
      return (
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-2 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Method
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Endpoint
            </div>
          </div>
          <div className='grid grid-cols-[auto_1fr] items-center gap-2 px-2 py-2'>
            <div>
              <span className='inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs'>
                {method || 'GET'}
              </span>
            </div>
            <div className='min-w-0'>
              <span
                className='block overflow-x-auto whitespace-nowrap font-mono text-foreground text-xs'
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
      const entries = Object.entries(variables)
      return (
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-2 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Name
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Value
            </div>
          </div>
          {entries.length === 0 ? (
            <div className='px-2 py-2 text-muted-foreground text-xs'>No variables provided</div>
          ) : (
            <div className='divide-y divide-muted/60'>
              {entries.map(([k, v]) => (
                <div key={k} className='grid grid-cols-[auto_1fr] items-center gap-2 px-2 py-1.5'>
                  <div className='truncate font-medium text-amber-800 text-xs dark:text-amber-200'>
                    {k}
                  </div>
                  <div className='min-w-0'>
                    <span className='block overflow-x-auto whitespace-nowrap font-mono text-amber-700 text-xs dark:text-amber-300'>
                      {String(v)}
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
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-3 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Name
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Type
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Value
            </div>
          </div>
          {ops.length === 0 ? (
            <div className='px-2 py-2 text-muted-foreground text-xs'>No operations provided</div>
          ) : (
            <div className='divide-y divide-amber-200 dark:divide-amber-800'>
              {ops.map((op, idx) => (
                <div key={idx} className='grid grid-cols-3 items-center gap-0 px-2 py-1.5'>
                  <div className='min-w-0'>
                    <span className='truncate text-amber-800 text-xs dark:text-amber-200'>
                      {String(op.name || '')}
                    </span>
                  </div>
                  <div>
                    <span className='rounded border px-1 py-0.5 text-[10px] text-muted-foreground'>
                      {String(op.type || '')}
                    </span>
                  </div>
                  <div className='min-w-0'>
                    {op.value !== undefined ? (
                      <span className='block overflow-x-auto whitespace-nowrap font-mono text-amber-700 text-xs dark:text-amber-300'>
                        {String(op.value)}
                      </span>
                    ) : (
                      <span className='text-muted-foreground text-xs'>—</span>
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

  // Compute icon element from tool's display metadata (fallback to Loader2)
  const renderDisplayIcon = () => {
    try {
      // Determine the icon component (prefer store, then registry, else Loader2)
      const IconFromStore = (toolCall as any).display?.icon
      let IconComp: any | undefined = IconFromStore
      if (!IconComp) {
        try {
          const def = getRegisteredTools()[toolCall.name] as any
          IconComp = def?.metadata?.displayNames?.[toolCall.state]?.icon
        } catch {}
      }
      if (!IconComp) IconComp = Loader2

      // Color by state
      let colorClass = ''
      const state = toolCall.state as any
      if (state === (ClientToolCallState as any).aborted || state === 'aborted') {
        colorClass = 'text-amber-500'
      } else if (state === (ClientToolCallState as any).error || state === 'error') {
        colorClass = 'text-red-500'
      } else if (state === (ClientToolCallState as any).success || state === 'success') {
        const isBuildOrEdit =
          toolCall.name === 'build_workflow' || toolCall.name === 'edit_workflow'
        colorClass = isBuildOrEdit ? 'text-[var(--brand-primary-hover-hex)]' : 'text-green-600'
      }

      // Only Loader2 should spin
      const spinClass = IconComp === Loader2 ? 'animate-spin' : ''

      return <IconComp className={`h-3 w-3 ${spinClass} ${colorClass}`} />
    } catch {
      return <Loader2 className='h-3 w-3 animate-spin' />
    }
  }

  return (
    <div className='flex w-full flex-col gap-1 py-1'>
      <div
        className={`flex items-center justify-between gap-2 ${isExpandableTool ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (isExpandableTool) setExpanded((e) => !e)
        }}
      >
        <div className='flex items-center gap-2 text-muted-foreground'>
          <div className='flex-shrink-0'>{renderDisplayIcon()}</div>
          <span className='text-base'>{displayName}</span>
        </div>
        {showButtons ? (
          <RunSkipButtons toolCall={toolCall} onStateChange={handleStateChange} />
        ) : showMoveToBackground ? (
          <Button
            // Intentionally minimal wiring per requirements
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
            size='sm'
            className='h-6 bg-blue-600 px-2 font-medium text-white text-xs hover:bg-blue-500 disabled:opacity-50 dark:bg-blue-400 dark:text-gray-900 dark:hover:bg-blue-300'
            title='Move to Background'
          >
            Move to Background
          </Button>
        ) : null}
      </div>
      {isExpandableTool && expanded && <div className='pr-1 pl-5'>{renderPendingDetails()}</div>}
    </div>
  )
}
