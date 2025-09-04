'use client'

import { useState } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Loader2, Settings, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ToolCallGroup, ToolCallState } from '@/lib/copilot/types'
import { cn } from '@/lib/utils'

interface ToolCallProps {
  toolCall: ToolCallState
  isCompact?: boolean
}

interface ToolCallGroupProps {
  group: ToolCallGroup
  isCompact?: boolean
}

interface ToolCallIndicatorProps {
  type: 'status' | 'thinking' | 'execution'
  content: string
  toolNames?: string[]
}

// Detection State Component
export function ToolCallDetection({ content }: { content: string }) {
  return (
    <div className='flex min-w-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
      <Loader2 className='h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400' />
      <span className='min-w-0 truncate text-blue-800 dark:text-blue-200'>{content}</span>
    </div>
  )
}

// Execution State Component
export function ToolCallExecution({ toolCall, isCompact = false }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(!isCompact)

  return (
    <div className='min-w-0 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant='ghost'
            className='w-full min-w-0 justify-between px-3 py-4 hover:bg-amber-100 dark:hover:bg-amber-900'
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              <Settings className='h-4 w-4 shrink-0 animate-pulse text-amber-600 dark:text-amber-400' />
              <span className='min-w-0 truncate font-mono text-amber-800 text-xs dark:text-amber-200'>
                {toolCall.displayName || toolCall.name}
              </span>
              {toolCall.progress && (
                <Badge
                  variant='outline'
                  className='shrink-0 text-amber-700 text-xs dark:text-amber-300'
                >
                  {toolCall.progress}
                </Badge>
              )}
            </div>
            {isExpanded ? (
              <ChevronDown className='h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400' />
            ) : (
              <ChevronRight className='h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400' />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='min-w-0 max-w-full px-3 pb-3'>
          <div className='min-w-0 max-w-full space-y-2'>
            <div className='flex items-center gap-2 text-amber-700 text-xs dark:text-amber-300'>
              <Loader2 className='h-3 w-3 shrink-0 animate-spin' />
              <span>Executing...</span>
            </div>
            {toolCall.parameters &&
              Object.keys(toolCall.parameters).length > 0 &&
              (toolCall.name === 'make_api_request' ||
                toolCall.name === 'set_environment_variables') && (
                <div className='min-w-0 max-w-full rounded bg-amber-100 p-2 dark:bg-amber-900'>
                  <div className='mb-1 font-medium text-amber-800 text-xs dark:text-amber-200'>
                    Parameters:
                  </div>
                  <div className='min-w-0 max-w-full break-all font-mono text-amber-700 text-xs dark:text-amber-300'>
                    {JSON.stringify(toolCall.parameters, null, 2)}
                  </div>
                </div>
              )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// Completion State Component
export function ToolCallCompletion({ toolCall, isCompact = false }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isSuccess = toolCall.state === 'completed'
  const isError = toolCall.state === 'error'
  const isAborted = toolCall.state === 'aborted'

  const formatDuration = (duration?: number) => {
    if (!duration) return ''
    return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`
  }

  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border',
        isSuccess && 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
        isError && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
        isAborted && 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950'
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant='ghost'
            className={cn(
              'w-full min-w-0 justify-between px-3 py-4',
              isSuccess && 'hover:bg-green-100 dark:hover:bg-green-900',
              isError && 'hover:bg-red-100 dark:hover:bg-red-900',
              isAborted && 'hover:bg-orange-100 dark:hover:bg-orange-900'
            )}
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              {isSuccess && (
                <CheckCircle className='h-4 w-4 shrink-0 text-green-600 dark:text-green-400' />
              )}
              {isError && <XCircle className='h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />}
              {isAborted && (
                <XCircle className='h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400' />
              )}
              <span
                className={cn(
                  'min-w-0 truncate font-mono text-xs',
                  isSuccess && 'text-green-800 dark:text-green-200',
                  isError && 'text-red-800 dark:text-red-200',
                  isAborted && 'text-orange-800 dark:text-orange-200'
                )}
              >
                {toolCall.displayName || toolCall.name}
              </span>
              {toolCall.duration && (
                <Badge
                  variant='outline'
                  className={cn(
                    'shrink-0 text-xs',
                    isSuccess && 'text-green-700 dark:text-green-300',
                    isError && 'text-red-700 dark:text-red-300',
                    isAborted && 'text-orange-700 dark:text-orange-300'
                  )}
                  style={{ fontSize: '0.625rem' }}
                >
                  {formatDuration(toolCall.duration)}
                </Badge>
              )}
            </div>
            <div className='flex shrink-0 items-center'>
              {isExpanded ? (
                <ChevronDown
                  className={cn(
                    'h-4 w-4',
                    isSuccess && 'text-green-600 dark:text-green-400',
                    isError && 'text-red-600 dark:text-red-400'
                  )}
                />
              ) : (
                <ChevronRight
                  className={cn(
                    'h-4 w-4',
                    isSuccess && 'text-green-600 dark:text-green-400',
                    isError && 'text-red-600 dark:text-red-400'
                  )}
                />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='min-w-0 max-w-full px-3 pb-3'>
          <div className='min-w-0 max-w-full space-y-2'>
            {toolCall.parameters &&
              Object.keys(toolCall.parameters).length > 0 &&
              (toolCall.name === 'make_api_request' ||
                toolCall.name === 'set_environment_variables') && (
                <div
                  className={cn(
                    'min-w-0 max-w-full rounded p-2',
                    isSuccess && 'bg-green-100 dark:bg-green-900',
                    isError && 'bg-red-100 dark:bg-red-900'
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 font-medium text-xs',
                      isSuccess && 'text-green-800 dark:text-green-200',
                      isError && 'text-red-800 dark:text-red-200'
                    )}
                  >
                    Parameters:
                  </div>
                  <div
                    className={cn(
                      'min-w-0 max-w-full break-all font-mono text-xs',
                      isSuccess && 'text-green-700 dark:text-green-300',
                      isError && 'text-red-700 dark:text-red-300'
                    )}
                  >
                    {JSON.stringify(toolCall.parameters, null, 2)}
                  </div>
                </div>
              )}

            {toolCall.error && (
              <div className='min-w-0 max-w-full rounded bg-red-100 p-2 dark:bg-red-900'>
                <div className='mb-1 font-medium text-red-800 text-xs dark:text-red-200'>
                  Error:
                </div>
                <div className='min-w-0 max-w-full break-all font-mono text-red-700 text-xs dark:text-red-300'>
                  {toolCall.error}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// Group Component for Multiple Tool Calls
export function ToolCallGroupComponent({ group, isCompact = false }: ToolCallGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const completedCount = group.toolCalls.filter((t) => t.state === 'completed').length
  const totalCount = group.toolCalls.length
  const isAllCompleted = completedCount === totalCount
  const hasErrors = group.toolCalls.some((t) => t.state === 'error')

  return (
    <div className='min-w-0 space-y-2'>
      {group.summary && (
        <div className='flex min-w-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
          <Settings className='h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400' />
          <span className='min-w-0 truncate text-blue-800 dark:text-blue-200'>{group.summary}</span>
          {!isAllCompleted && (
            <Badge variant='outline' className='shrink-0 text-blue-700 text-xs dark:text-blue-300'>
              {completedCount}/{totalCount}
            </Badge>
          )}
        </div>
      )}

      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant='ghost'
            className='w-full min-w-0 justify-between px-3 py-3 text-sm hover:bg-muted'
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              <span className='min-w-0 truncate text-muted-foreground'>
                {isAllCompleted ? 'Completed' : 'In Progress'} ({completedCount}/{totalCount})
              </span>
              {hasErrors && (
                <Badge variant='destructive' className='shrink-0 text-xs'>
                  Errors
                </Badge>
              )}
            </div>
            {isExpanded ? (
              <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
            ) : (
              <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='min-w-0 max-w-full space-y-2'>
          {group.toolCalls.map((toolCall) => (
            <div key={toolCall.id} className='min-w-0 max-w-full'>
              {toolCall.state === 'executing' && (
                <ToolCallExecution toolCall={toolCall} isCompact={isCompact} />
              )}
              {(toolCall.state === 'completed' || toolCall.state === 'error') && (
                <ToolCallCompletion toolCall={toolCall} isCompact={isCompact} />
              )}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// Status Indicator Component
export function ToolCallIndicator({ type, content, toolNames }: ToolCallIndicatorProps) {
  if (type === 'status' && toolNames) {
    return (
      <div className='flex min-w-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
        <Loader2 className='h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400' />
        <span className='min-w-0 truncate text-blue-800 dark:text-blue-200'>
          🔄 {toolNames.join(' • ')}
        </span>
      </div>
    )
  }

  return (
    <div className='flex min-w-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
      <Loader2 className='h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400' />
      <span className='min-w-0 truncate text-blue-800 dark:text-blue-200'>{content}</span>
    </div>
  )
}
