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

interface ExampleCommandProps {
  command: string
  apiKey: string
  endpoint: string
  showLabel?: boolean
  getInputFormatExample?: () => string
}

type ExampleMode = 'sync' | 'async'
type ExampleType = 'execute' | 'status' | 'rate-limits'

export function ExampleCommand({
  command,
  apiKey,
  endpoint,
  showLabel = true,
  getInputFormatExample,
}: ExampleCommandProps) {
  const [mode, setMode] = useState<ExampleMode>('sync')
  const [exampleType, setExampleType] = useState<ExampleType>('execute')
  const isAsyncEnabled = isTruthy(getEnv('NEXT_PUBLIC_TRIGGER_DEV_ENABLED'))

  // Format the curl command to use a placeholder for the API key
  const formatCurlCommand = (command: string, apiKey: string) => {
    if (!command.includes('curl')) return command

    // Replace the actual API key with a placeholder in the command
    const sanitizedCommand = command.replace(apiKey, 'SIM_API_KEY')

    // Format the command with line breaks for better readability
    return sanitizedCommand
      .replace(' -H ', '\n  -H ')
      .replace(' -d ', '\n  -d ')
      .replace(' http', '\n  http')
  }

  // Get the actual command with real API key for copying
  const getActualCommand = () => {
    const baseEndpoint = endpoint
    const inputExample = getInputFormatExample
      ? getInputFormatExample()
      : ' -d \'{"input": "your data here"}\''

    switch (mode) {
      case 'sync':
        // Use the original command but ensure it has the real API key
        return command

      case 'async':
        switch (exampleType) {
          case 'execute':
            return `curl -X POST \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -H "X-Execution-Mode: async"${inputExample} \\
  ${baseEndpoint}`

          case 'status': {
            const baseUrl = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: ${apiKey}" \\
  ${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION`
          }

          case 'rate-limits': {
            const baseUrlForRateLimit = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: ${apiKey}" \\
  ${baseUrlForRateLimit}/api/users/me/usage-limits`
          }

          default:
            return command
        }

      default:
        return command
    }
  }

  const getDisplayCommand = () => {
    const baseEndpoint = endpoint.replace(apiKey, 'SIM_API_KEY')
    const inputExample = getInputFormatExample
      ? getInputFormatExample()
      : ' -d \'{"input": "your data here"}\''

    switch (mode) {
      case 'sync':
        return formatCurlCommand(command, apiKey)

      case 'async':
        switch (exampleType) {
          case 'execute':
            return `curl -X POST \\
  -H "X-API-Key: SIM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "X-Execution-Mode: async"${inputExample} \\
  ${baseEndpoint}`

          case 'status': {
            const baseUrl = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: SIM_API_KEY" \\
  ${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION`
          }

          case 'rate-limits': {
            const baseUrlForRateLimit = baseEndpoint.split('/api/workflows/')[0]
            return `curl -H "X-API-Key: SIM_API_KEY" \\
  ${baseUrlForRateLimit}/api/users/me/usage-limits`
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
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between'>
        {showLabel && <Label className='font-medium text-sm'>Example</Label>}
        {isAsyncEnabled && (
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
                  disabled={mode === 'sync'}
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
          </div>
        )}
      </div>

      <div className='group relative h-[120px] rounded-md border bg-background transition-colors hover:bg-muted/50'>
        <pre className='h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs'>
          {getDisplayCommand()}
        </pre>
        <CopyButton text={getActualCommand()} />
      </div>
    </div>
  )
}
