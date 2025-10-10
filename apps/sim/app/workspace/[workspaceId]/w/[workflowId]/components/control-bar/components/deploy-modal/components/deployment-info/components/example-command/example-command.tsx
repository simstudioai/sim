'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { getEnv, isTruthy } from '@/lib/env'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components/output-select/output-select'

interface ExampleCommandProps {
  command: string
  apiKey: string
  endpoint: string
  showLabel?: boolean
  getInputFormatExample?: (includeStreaming?: boolean) => string
  workflowId: string | null
  selectedStreamingOutputs: string[]
  onSelectedStreamingOutputsChange: (outputs: string[]) => void
}

type ExampleMode = 'sync' | 'async' | 'stream'
type ExampleType = 'execute' | 'status' | 'rate-limits'

export function ExampleCommand({
  command,
  apiKey,
  endpoint,
  showLabel = true,
  getInputFormatExample,
  workflowId,
  selectedStreamingOutputs,
  onSelectedStreamingOutputsChange,
}: ExampleCommandProps) {
  const [mode, setMode] = useState<ExampleMode>('sync')
  const [exampleType, setExampleType] = useState<ExampleType>('execute')
  const isAsyncEnabled = isTruthy(getEnv('NEXT_PUBLIC_TRIGGER_DEV_ENABLED'))

  const formatCurlCommand = (command: string, apiKey: string) => {
    if (!command.includes('curl')) return command

    const sanitizedCommand = command.replace(apiKey, '$SIM_API_KEY')

    return sanitizedCommand
      .replace(' -H ', '\n  -H ')
      .replace(' -d ', '\n  -d ')
      .replace(' http', '\n  http')
  }

  const getActualCommand = () => {
    const displayCommand = getDisplayCommand()
    return displayCommand
      .replace(/\\\n\s*/g, ' ') // Remove backslash + newline + whitespace
      .replace(/\n\s*/g, ' ') // Remove any remaining newlines + whitespace
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim()
  }

  const getDisplayCommand = () => {
    const baseEndpoint = endpoint.replace(apiKey, '$SIM_API_KEY')
    const inputExample = getInputFormatExample
      ? getInputFormatExample(false)
      : ' -d \'{"input": "your data here"}\''

    const addStreamingParams = (dashD: string) => {
      const match = dashD.match(/-d\s*'([\s\S]*)'/)
      if (!match) {
        const payload: Record<string, any> = { stream: true }
        if (selectedStreamingOutputs && selectedStreamingOutputs.length > 0) {
          payload.selectedOutputs = selectedStreamingOutputs
        }
        return ` -d '${JSON.stringify(payload)}'`
      }
      try {
        const payload = JSON.parse(match[1]) as Record<string, any>
        payload.stream = true
        if (selectedStreamingOutputs && selectedStreamingOutputs.length > 0) {
          payload.selectedOutputs = selectedStreamingOutputs
        }
        return ` -d '${JSON.stringify(payload)}'`
      } catch {
        return dashD
      }
    }

    switch (mode) {
      case 'sync':
        if (getInputFormatExample) {
          const syncInputExample = getInputFormatExample(false)
          return `curl -X POST \\\n  -H "X-API-Key: $SIM_API_KEY" \\\n  -H "Content-Type: application/json"${syncInputExample} \\\n  ${baseEndpoint}`
        }
        return formatCurlCommand(command, apiKey)

      case 'stream': {
        const streamDashD = addStreamingParams(inputExample)
        return `curl -X POST \\\n  -H "X-API-Key: $SIM_API_KEY" \\\n  -H "Content-Type: application/json"${streamDashD} \\\n  ${baseEndpoint}`
      }

      case 'async':
        switch (exampleType) {
          case 'execute':
            return `curl -X POST \\\n  -H "X-API-Key: $SIM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Execution-Mode: async"${inputExample} \\\n  ${baseEndpoint}`

          case 'status': {
            const baseUrl = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: $SIM_API_KEY" \\\n  ${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION`
          }

          case 'rate-limits': {
            const baseUrlForRateLimit = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: $SIM_API_KEY" \\\n  ${baseUrlForRateLimit}/api/users/me/usage-limits`
          }

          default:
            return formatCurlCommand(command, apiKey)
        }

      default:
        return formatCurlCommand(command, apiKey)
    }
  }

  const getExampleTitle = () => {
    switch (exampleType) {
      case 'execute':
        return 'Async Execution'
      case 'status':
        return 'Check Job Status'
      case 'rate-limits':
        return 'Rate Limits & Usage'
      default:
        return 'Async Execution'
    }
  }

  return (
    <div className='space-y-4'>
      {/* Example Command */}
      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          {showLabel && <Label className='font-medium text-sm'>Example</Label>}
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMode('sync')}
              className={`h-6 min-w-[50px] px-2 py-1 text-xs transition-none ${
                mode === 'sync'
                  ? 'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground'
                  : ''
              }`}
            >
              Sync
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMode('stream')}
              className={`h-6 min-w-[50px] px-2 py-1 text-xs transition-none ${
                mode === 'stream'
                  ? 'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground'
                  : ''
              }`}
            >
              Stream
            </Button>
            {isAsyncEnabled && (
              <>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setMode('async')}
                  className={`h-6 min-w-[50px] px-2 py-1 text-xs transition-none ${
                    mode === 'async'
                      ? 'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground'
                      : ''
                  }`}
                >
                  Async
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-6 min-w-[140px] justify-between px-2 py-1 text-xs'
                      disabled={mode === 'sync' || mode === 'stream'}
                    >
                      <span className='truncate'>{getExampleTitle()}</span>
                      <ChevronDown className='ml-1 h-3 w-3 flex-shrink-0' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem
                      className='cursor-pointer'
                      onClick={() => setExampleType('execute')}
                    >
                      Async Execution
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='cursor-pointer'
                      onClick={() => setExampleType('status')}
                    >
                      Check Job Status
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='cursor-pointer'
                      onClick={() => setExampleType('rate-limits')}
                    >
                      Rate Limits & Usage
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {/* Output selector for Stream mode */}
        {mode === 'stream' && (
          <div className='space-y-2'>
            <div className='text-muted-foreground text-xs'>Select outputs to stream</div>
            <OutputSelect
              workflowId={workflowId}
              selectedOutputs={selectedStreamingOutputs}
              onOutputSelect={onSelectedStreamingOutputsChange}
              placeholder='Select outputs for streaming'
              valueMode='label'
            />
          </div>
        )}

        <div className='group relative overflow-x-auto rounded-md border bg-background transition-colors hover:bg-muted/50'>
          <pre className='whitespace-pre p-3 font-mono text-xs'>{getDisplayCommand()}</pre>
          <CopyButton text={getActualCommand()} />
        </div>
      </div>
    </div>
  )
}
