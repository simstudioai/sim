import { useEffect, useRef, useState } from 'react'
import { BookOpen, Code, Info, RectangleHorizontal, RectangleVertical } from 'lucide-react'
import { Handle, type NodeProps, Position, useUpdateNodeInternals } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn, formatDateTime, validateName } from '@/lib/utils'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { SubBlock } from './components/sub-block/sub-block'

interface WorkflowBlockProps {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
  isPreview?: boolean
  subBlockValues?: Record<string, any>
}

// Combine both interfaces into a single component
export function WorkflowBlock({ id, data }: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isActive: dataIsActive, isPending } = data

  // State management
  const [isConnecting, setIsConnecting] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [isLoadingScheduleInfo, setIsLoadingScheduleInfo] = useState(false)
  const [scheduleInfo, setScheduleInfo] = useState<{
    scheduleTiming: string
    nextRunAt: string | null
    lastRanAt: string | null
    timezone: string
    status?: string
    isDisabled?: boolean
    id?: string
  } | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<{
    webhookPath: string
    provider: string
  } | null>(null)

  // Refs
  const blockRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  // Workflow store selectors
  const lastUpdate = useWorkflowStore((state) => state.lastUpdate)
  const isEnabled = useWorkflowStore((state) => state.blocks[id]?.enabled ?? true)
  const horizontalHandles = useWorkflowStore(
    (state) => state.blocks[id]?.horizontalHandles ?? false
  )
  const isWide = useWorkflowStore((state) => state.blocks[id]?.isWide ?? false)
  const blockHeight = useWorkflowStore((state) => state.blocks[id]?.height ?? 0)
  const hasActiveWebhook = useWorkflowStore((state) => state.hasActiveWebhook ?? false)
  const blockAdvancedMode = useWorkflowStore((state) => state.blocks[id]?.advancedMode ?? false)
  const toggleBlockAdvancedMode = useWorkflowStore((state) => state.toggleBlockAdvancedMode)

  // Workflow store actions
  const updateBlockName = useWorkflowStore((state) => state.updateBlockName)
  const toggleBlockWide = useWorkflowStore((state) => state.toggleBlockWide)
  const updateBlockHeight = useWorkflowStore((state) => state.updateBlockHeight)

  // Execution store
  const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
  const isActive = dataIsActive || isActiveBlock

  const reactivateSchedule = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reactivate' }),
      })

      if (response.ok) {
        fetchScheduleInfo()
      } else {
        console.error('Failed to reactivate schedule')
      }
    } catch (error) {
      console.error('Error reactivating schedule:', error)
    }
  }

  const fetchScheduleInfo = async () => {
    try {
      setIsLoadingScheduleInfo(true)
      const workflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!workflowId) return

      const response = await fetch(`/api/schedules?workflowId=${workflowId}&mode=schedule`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (!response.ok) {
        setScheduleInfo(null)
        return
      }

      const data = await response.json()

      if (!data.schedule) {
        setScheduleInfo(null)
        return
      }

      let scheduleTiming = 'Unknown schedule'
      if (data.schedule.cronExpression) {
        scheduleTiming = parseCronToHumanReadable(data.schedule.cronExpression)
      }

      const baseInfo = {
        scheduleTiming,
        nextRunAt: data.schedule.nextRunAt as string | null,
        lastRanAt: data.schedule.lastRanAt as string | null,
        timezone: data.schedule.timezone || 'UTC',
        status: data.schedule.status as string,
        isDisabled: data.schedule.status === 'disabled',
        id: data.schedule.id as string,
      }

      try {
        const statusRes = await fetch(`/api/schedules/${baseInfo.id}/status`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })

        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setScheduleInfo({
            scheduleTiming: baseInfo.scheduleTiming,
            nextRunAt: statusData.nextRunAt ?? baseInfo.nextRunAt,
            lastRanAt: statusData.lastRanAt ?? baseInfo.lastRanAt,
            timezone: baseInfo.timezone,
            status: statusData.status ?? baseInfo.status,
            isDisabled: statusData.isDisabled ?? baseInfo.isDisabled,
            id: baseInfo.id,
          })
          return
        }
      } catch (err) {
        console.error('Error fetching schedule status:', err)
      }

      setScheduleInfo(baseInfo)
    } catch (error) {
      console.error('Error fetching schedule info:', error)
      setScheduleInfo(null)
    } finally {
      setIsLoadingScheduleInfo(false)
    }
  }

  useEffect(() => {
    if (type === 'starter') {
      fetchScheduleInfo()
    } else {
      setScheduleInfo(null)
    }
  }, [type])

  // Get webhook information for the tooltip
  useEffect(() => {
    if (type === 'starter' && hasActiveWebhook) {
      const fetchWebhookInfo = async () => {
        try {
          const workflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!workflowId) return

          const response = await fetch(`/api/webhooks?workflowId=${workflowId}`)
          if (response.ok) {
            const data = await response.json()
            if (data.webhooks?.[0]?.webhook) {
              const webhook = data.webhooks[0].webhook
              setWebhookInfo({
                webhookPath: webhook.path || '',
                provider: webhook.provider || 'generic',
              })
            }
          }
        } catch (error) {
          console.error('Error fetching webhook info:', error)
        }
      }

      fetchWebhookInfo()
    } else if (!hasActiveWebhook) {
      setWebhookInfo(null)
    }
  }, [type, hasActiveWebhook])

  // Update node internals when handles change
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, horizontalHandles, updateNodeInternals])

  const debounce = (func: (...args: any[]) => void, wait: number) => {
    let timeout: NodeJS.Timeout
    return (...args: any[]) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => func(...args), wait)
    }
  }

  // Add effect to observe size changes with debounced updates
  useEffect(() => {
    if (!contentRef.current) return

    let rafId: number
    const debouncedUpdate = debounce((height: number) => {
      if (height !== blockHeight) {
        updateBlockHeight(id, height)
        updateNodeInternals(id)
      }
    }, 100)

    const resizeObserver = new ResizeObserver((entries) => {
      // Cancel any pending animation frame
      if (rafId) {
        cancelAnimationFrame(rafId)
      }

      // Schedule the update on the next animation frame
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const height =
            entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height
          debouncedUpdate(height)
        }
      })
    })

    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [id, blockHeight, updateBlockHeight, updateNodeInternals, lastUpdate])

  // SubBlock layout management
  function groupSubBlocks(subBlocks: SubBlockConfig[], blockId: string) {
    const rows: SubBlockConfig[][] = []
    let currentRow: SubBlockConfig[] = []
    let currentRowWidth = 0

    // Get the appropriate state for conditional evaluation
    let stateToUse: Record<string, any> = {}

    if (data.isPreview && data.subBlockValues) {
      // In preview mode, use the preview values
      stateToUse = data.subBlockValues
    } else {
      // In normal mode, use merged state
      const blocks = useWorkflowStore.getState().blocks
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId || undefined
      const mergedState = mergeSubblockState(blocks, activeWorkflowId, blockId)[blockId]
      stateToUse = mergedState?.subBlocks || {}
    }

    const isAdvancedMode = useWorkflowStore.getState().blocks[blockId]?.advancedMode ?? false

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = subBlocks.filter((block) => {
      if (block.hidden) return false

      // Filter by mode if specified
      if (block.mode) {
        if (block.mode === 'basic' && isAdvancedMode) return false
        if (block.mode === 'advanced' && !isAdvancedMode) return false
      }

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      // Get the values of the fields this block depends on from the appropriate state
      const fieldValue = stateToUse[block.condition.field]?.value
      const andFieldValue = block.condition.and
        ? stateToUse[block.condition.and.field]?.value
        : undefined

      // Check if the condition value is an array
      const isValueMatch = Array.isArray(block.condition.value)
        ? fieldValue != null &&
          (block.condition.not
            ? !block.condition.value.includes(fieldValue as string | number | boolean)
            : block.condition.value.includes(fieldValue as string | number | boolean))
        : block.condition.not
          ? fieldValue !== block.condition.value
          : fieldValue === block.condition.value

      // Check both conditions if 'and' is present
      const isAndValueMatch =
        !block.condition.and ||
        (Array.isArray(block.condition.and.value)
          ? andFieldValue != null &&
            (block.condition.and.not
              ? !block.condition.and.value.includes(andFieldValue as string | number | boolean)
              : block.condition.and.value.includes(andFieldValue as string | number | boolean))
          : block.condition.and.not
            ? andFieldValue !== block.condition.and.value
            : andFieldValue === block.condition.and.value)

      return isValueMatch && isAndValueMatch
    })

    visibleSubBlocks.forEach((block) => {
      const blockWidth = block.layout === 'half' ? 0.5 : 1
      if (currentRowWidth + blockWidth > 1) {
        if (currentRow.length > 0) {
          rows.push([...currentRow])
        }
        currentRow = [block]
        currentRowWidth = blockWidth
      } else {
        currentRow.push(block)
        currentRowWidth += blockWidth
      }
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    return rows
  }

  const subBlockRows = groupSubBlocks(config.subBlocks, id)

  // Name editing handlers
  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent drag handler from interfering
    setEditedName(name)
    setIsEditing(true)
  }

  // Auto-focus the input when edit mode is activated
  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [isEditing])

  // Handle node name change with validation
  const handleNodeNameChange = (newName: string) => {
    const validatedName = validateName(newName)
    setEditedName(validatedName.slice(0, 18))
  }

  const handleNameSubmit = () => {
    const trimmedName = editedName.trim().slice(0, 18)
    if (trimmedName && trimmedName !== name) {
      updateBlockName(id, trimmedName)
    }
    setIsEditing(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  // Check if this is a starter block and has active schedule or webhook
  const isStarterBlock = type === 'starter'
  const showWebhookIndicator = isStarterBlock && hasActiveWebhook

  const getProviderName = (providerId: string): string => {
    const providers: Record<string, string> = {
      whatsapp: 'WhatsApp',
      github: 'GitHub',
      discord: 'Discord',
      stripe: 'Stripe',
      generic: 'General',
      slack: 'Slack',
      airtable: 'Airtable',
      gmail: 'Gmail',
    }
    return providers[providerId] || 'Webhook'
  }

  const shouldShowScheduleBadge = isStarterBlock && !isLoadingScheduleInfo && scheduleInfo !== null

  return (
    <div className='group relative'>
      <Card
        ref={blockRef}
        className={cn(
          'relative cursor-default select-none shadow-md',
          'transition-block-bg transition-ring',
          isWide ? 'w-[480px]' : 'w-[320px]',
          !isEnabled && 'shadow-sm',
          isActive && 'animate-pulse-ring ring-2 ring-blue-500',
          isPending && 'ring-2 ring-amber-500',
          'z-[20]'
        )}
      >
        {/* Show debug indicator for pending blocks */}
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        <ActionBar blockId={id} blockType={type} />
        <ConnectionBlocks blockId={id} setIsConnecting={setIsConnecting} />

        {/* Input Handle - Don't show for starter blocks */}
        {type !== 'starter' && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={cn(
              horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
              '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
              '!z-[30]',
              'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
              horizontalHandles
                ? 'hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none'
                : 'hover:!h-[10px] hover:!top-[-10px] hover:!rounded-t-full hover:!rounded-b-none',
              '!cursor-crosshair',
              'transition-[colors] duration-150',
              horizontalHandles ? '!left-[-7px]' : '!top-[-7px]'
            )}
            style={{
              ...(horizontalHandles
                ? { top: '50%', transform: 'translateY(-50%)' }
                : { left: '50%', transform: 'translateX(-50%)' }),
            }}
            data-nodeid={id}
            data-handleid='target'
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => connection.source !== id}
          />
        )}

        {/* Block Header */}
        <div
          className='workflow-drag-handle flex cursor-grab items-center justify-between border-b p-3 [&:active]:cursor-grabbing'
          onMouseDown={(e) => {
            e.stopPropagation()
          }}
        >
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            <div
              className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded'
              style={{ backgroundColor: isEnabled ? config.bgColor : 'gray' }}
            >
              <config.icon className='h-5 w-5 text-white' />
            </div>
            <div className='min-w-0'>
              {isEditing ? (
                <input
                  ref={nameInputRef}
                  type='text'
                  value={editedName}
                  onChange={(e) => handleNodeNameChange(e.target.value)}
                  onBlur={handleNameSubmit}
                  onKeyDown={handleNameKeyDown}
                  className='border-none bg-transparent p-0 font-medium text-md outline-none'
                  maxLength={18}
                />
              ) : (
                <span
                  className={cn(
                    'inline-block cursor-text font-medium text-md hover:text-muted-foreground',
                    !isEnabled && 'text-muted-foreground'
                  )}
                  onClick={handleNameClick}
                  title={name}
                  style={{
                    maxWidth: !isEnabled ? (isWide ? '200px' : '140px') : '180px',
                  }}
                >
                  {name}
                </span>
              )}
            </div>
          </div>
          <div className='flex flex-shrink-0 items-center gap-2'>
            {!isEnabled && (
              <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
                Disabled
              </Badge>
            )}
            {/* Schedule indicator badge - displayed for starter blocks with active schedules */}
            {shouldShowScheduleBadge && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant='outline'
                    className={cn(
                      'flex items-center gap-1 font-normal text-xs',
                      scheduleInfo?.isDisabled
                        ? 'cursor-pointer border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
                        : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                    )}
                    onClick={
                      scheduleInfo?.isDisabled && scheduleInfo?.id
                        ? () => reactivateSchedule(scheduleInfo.id!)
                        : undefined
                    }
                  >
                    <div className='relative mr-0.5 flex items-center justify-center'>
                      <div
                        className={cn(
                          'absolute h-3 w-3 rounded-full',
                          scheduleInfo?.isDisabled ? 'bg-amber-500/20' : 'bg-green-500/20'
                        )}
                      />
                      <div
                        className={cn(
                          'relative h-2 w-2 rounded-full',
                          scheduleInfo?.isDisabled ? 'bg-amber-500' : 'bg-green-500'
                        )}
                      />
                    </div>
                    {scheduleInfo?.isDisabled ? 'Disabled' : 'Scheduled'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side='top' className='max-w-[300px] p-4'>
                  {scheduleInfo ? (
                    <>
                      <p className='text-sm'>{scheduleInfo.scheduleTiming}</p>
                      {scheduleInfo.isDisabled && (
                        <p className='mt-1 font-medium text-amber-600 text-sm'>
                          This schedule is currently disabled due to consecutive failures. Click the
                          badge to reactivate it.
                        </p>
                      )}
                      {scheduleInfo.nextRunAt && !scheduleInfo.isDisabled && (
                        <p className='mt-1 text-muted-foreground text-xs'>
                          Next run:{' '}
                          {formatDateTime(new Date(scheduleInfo.nextRunAt), scheduleInfo.timezone)}
                        </p>
                      )}
                      {scheduleInfo.lastRanAt && (
                        <p className='text-muted-foreground text-xs'>
                          Last run:{' '}
                          {formatDateTime(new Date(scheduleInfo.lastRanAt), scheduleInfo.timezone)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is running on a schedule.
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Webhook indicator badge - displayed for starter blocks with active webhooks */}
            {showWebhookIndicator && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant='outline'
                    className='flex items-center gap-1 border-green-200 bg-green-50 font-normal text-green-600 text-xs hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                  >
                    <div className='relative mr-0.5 flex items-center justify-center'>
                      <div className='absolute h-3 w-3 rounded-full bg-green-500/20' />
                      <div className='relative h-2 w-2 rounded-full bg-green-500' />
                    </div>
                    Webhook
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side='top' className='max-w-[300px] p-4'>
                  {webhookInfo ? (
                    <>
                      <p className='text-sm'>{getProviderName(webhookInfo.provider)} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>
                        Path: {webhookInfo.webhookPath}
                      </p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {config.subBlocks.some((block) => block.mode) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => toggleBlockAdvancedMode(id)}
                    className={cn('h-7 p-1 text-gray-500', blockAdvancedMode && 'text-[#701FFC]')}
                  >
                    <Code className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  {blockAdvancedMode ? 'Switch to Basic Mode' : 'Switch to Advanced Mode'}
                </TooltipContent>
              </Tooltip>
            )}
            {config.docsLink ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 p-1 text-gray-500'
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(config.docsLink, '_target', 'noopener,noreferrer')
                    }}
                  >
                    <BookOpen className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top'>See Docs</TooltipContent>
              </Tooltip>
            ) : (
              config.longDescription && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='sm' className='h-7 p-1 text-gray-500'>
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-4'>
                    <div className='space-y-3'>
                      <div>
                        <p className='mb-1 font-medium text-sm'>Description</p>
                        <p className='text-muted-foreground text-sm'>{config.longDescription}</p>
                      </div>
                      {config.outputs && (
                        <div>
                          <p className='mb-1 font-medium text-sm'>Output</p>
                          <div className='text-sm'>
                            {Object.entries(config.outputs).map(([key, value]) => (
                              <div key={key} className='mb-1'>
                                <span className='text-muted-foreground'>{key}</span>{' '}
                                {typeof value.type === 'object' ? (
                                  <div className='mt-1 pl-3'>
                                    {Object.entries(value.type).map(([typeKey, typeValue]) => (
                                      <div key={typeKey} className='flex items-start'>
                                        <span className='font-medium text-blue-500'>
                                          {typeKey}:
                                        </span>
                                        <span className='ml-1 text-green-500'>
                                          {typeValue as string}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className='text-green-500'>{value.type as string}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => toggleBlockWide(id)}
                  className='h-7 p-1 text-gray-500'
                >
                  {isWide ? (
                    <RectangleHorizontal className='h-5 w-5' />
                  ) : (
                    <RectangleVertical className='h-5 w-5' />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>{isWide ? 'Narrow Block' : 'Expand Block'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Block Content */}
        <div
          ref={contentRef}
          className='cursor-pointer space-y-4 px-4 pt-3 pb-4'
          onMouseDown={(e) => {
            e.stopPropagation()
          }}
        >
          {subBlockRows.length > 0
            ? subBlockRows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className='flex gap-4'>
                  {row.map((subBlock, blockIndex) => (
                    <div
                      key={`${id}-${rowIndex}-${blockIndex}`}
                      className={cn('space-y-1', subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                    >
                      <SubBlock
                        blockId={id}
                        config={subBlock}
                        isConnecting={isConnecting}
                        isPreview={data.isPreview}
                        subBlockValues={data.subBlockValues}
                      />
                    </div>
                  ))}
                </div>
              ))
            : null}
        </div>

        {/* Output Handle */}
        {type !== 'condition' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={cn(
                horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
                '!z-[30]',
                'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                horizontalHandles
                  ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
                  : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
                '!cursor-crosshair',
                'transition-[colors] duration-150',
                horizontalHandles ? '!right-[-7px]' : '!bottom-[-7px]'
              )}
              style={{
                ...(horizontalHandles
                  ? { top: '50%', transform: 'translateY(-50%)' }
                  : { left: '50%', transform: 'translateX(-50%)' }),
              }}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => connection.target !== id}
            />

            {/* Error Handle - Don't show for starter blocks */}
            {type !== 'starter' && (
              <Handle
                type='source'
                position={horizontalHandles ? Position.Right : Position.Bottom}
                id='error'
                className={cn(
                  horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                  '!bg-red-400 dark:!bg-red-500 !rounded-[2px] !border-none',
                  '!z-[30]',
                  'group-hover:!shadow-[0_0_0_3px_rgba(248,113,113,0.15)]',
                  horizontalHandles
                    ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
                    : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
                  '!cursor-crosshair',
                  'transition-[colors] duration-150'
                )}
                style={{
                  position: 'absolute',
                  ...(horizontalHandles
                    ? {
                        right: '-8px',
                        top: 'auto',
                        bottom: '30px',
                        transform: 'translateY(0)',
                      }
                    : {
                        bottom: '-7px',
                        left: 'auto',
                        right: '30px',
                        transform: 'translateX(0)',
                      }),
                }}
                data-nodeid={id}
                data-handleid='error'
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => connection.target !== id}
              />
            )}
          </>
        )}
      </Card>
    </div>
  )
}
