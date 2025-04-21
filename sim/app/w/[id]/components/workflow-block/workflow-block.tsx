import { useEffect, useRef, useState } from 'react'
import { Info, RectangleHorizontal, RectangleVertical } from 'lucide-react'
import { Handle, NodeProps, Position, useUpdateNodeInternals } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn, formatDateTime } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { SubBlock } from './components/sub-block/sub-block'

interface WorkflowBlockProps {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
}

// Combine both interfaces into a single component
export function WorkflowBlock({ id, data }: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isActive: dataIsActive, isPending } = data

  // State management
  const [isConnecting, setIsConnecting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [scheduleInfo, setScheduleInfo] = useState<{
    scheduleTiming: string
    nextRunAt: string | null
    lastRanAt: string | null
    timezone: string
  } | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<{
    webhookPath: string
    provider: string
  } | null>(null)

  // Refs
  const blockRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  // Workflow store selectors
  const lastUpdate = useWorkflowStore((state) => state.lastUpdate)
  const isEnabled = useWorkflowStore((state) => state.blocks[id]?.enabled ?? true)
  const horizontalHandles = useWorkflowStore(
    (state) => state.blocks[id]?.horizontalHandles ?? false
  )
  const isWide = useWorkflowStore((state) => state.blocks[id]?.isWide ?? false)
  const blockHeight = useWorkflowStore((state) => state.blocks[id]?.height ?? 0)
  const hasActiveSchedule = useWorkflowStore((state) => state.hasActiveSchedule ?? false)
  const hasActiveWebhook = useWorkflowStore((state) => state.hasActiveWebhook ?? false)

  // Workflow store actions
  const updateBlockName = useWorkflowStore((state) => state.updateBlockName)
  const toggleBlockWide = useWorkflowStore((state) => state.toggleBlockWide)
  const updateBlockHeight = useWorkflowStore((state) => state.updateBlockHeight)

  // Execution store
  const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
  const isActive = dataIsActive || isActiveBlock

  // Get schedule information for the tooltip
  useEffect(() => {
    if (type === 'starter' && hasActiveSchedule) {
      const fetchScheduleInfo = async () => {
        try {
          const workflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!workflowId) return

          const response = await fetch(`/api/schedules?workflowId=${workflowId}&mode=schedule`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
            },
          })

          if (response.ok) {
            const data = await response.json()
            if (data.schedule) {
              let scheduleTiming = 'Unknown schedule'
              if (data.schedule.cronExpression) {
                scheduleTiming = parseCronToHumanReadable(data.schedule.cronExpression)
              }

              setScheduleInfo({
                scheduleTiming,
                nextRunAt: data.schedule.nextRunAt,
                lastRanAt: data.schedule.lastRanAt,
                timezone: data.schedule.timezone || 'UTC',
              })
            }
          }
        } catch (error) {
          console.error('Error fetching schedule info:', error)
        }
      }

      fetchScheduleInfo()
    } else if (!hasActiveSchedule) {
      setScheduleInfo(null)
    }
  }, [type, hasActiveSchedule])

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

  // Add debounce helper
  const debounce = (func: Function, wait: number) => {
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

    // Get merged state for this block
    const blocks = useWorkflowStore.getState().blocks
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId || undefined
    const mergedState = mergeSubblockState(blocks, activeWorkflowId, blockId)[blockId]

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = subBlocks.filter((block) => {
      if (block.hidden) return false

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      // Get the values of the fields this block depends on from merged state
      const fieldValue = mergedState?.subBlocks[block.condition.field]?.value
      const andFieldValue = block.condition.and
        ? mergedState?.subBlocks[block.condition.and.field]?.value
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
  const handleNameClick = () => {
    setEditedName(name)
    setIsEditing(true)
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
  const showScheduleIndicator = isStarterBlock && hasActiveSchedule
  const showWebhookIndicator = isStarterBlock && hasActiveWebhook

  // Helper function to get provider name - only create once
  const getProviderName = (providerId: string): string => {
    const providers: Record<string, string> = {
      whatsapp: 'WhatsApp',
      github: 'GitHub',
      discord: 'Discord',
      stripe: 'Stripe',
      generic: 'General',
      slack: 'Slack',
      airtable: 'Airtable',
    }
    return providers[providerId] || 'Webhook'
  }

  return (
    <div className="relative group">
      <Card
        ref={blockRef}
        className={cn(
          'shadow-md select-none relative cursor-default',
          'transition-ring transition-block-bg',
          isWide ? 'w-[480px]' : 'w-[320px]',
          !isEnabled && 'shadow-sm',
          isActive && 'ring-2 animate-pulse-ring ring-blue-500',
          isPending && 'ring-2 ring-amber-500',
          'z-[20]'
        )}
      >
        {/* Show debug indicator for pending blocks */}
        {isPending && (
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-amber-500 text-white text-xs px-2 py-0.5 rounded-t-md z-10">
            Next Step
          </div>
        )}

        <ActionBar blockId={id} blockType={type} />
        <ConnectionBlocks blockId={id} setIsConnecting={setIsConnecting} />

        {/* Input Handle - Don't show for starter blocks */}
        {type !== 'starter' && (
          <Handle
            type="target"
            position={horizontalHandles ? Position.Left : Position.Top}
            id="target"
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
            data-handleid="target"
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => true}
          />
        )}

        {/* Block Header */}
        <div className="flex items-center justify-between p-3 border-b workflow-drag-handle cursor-grab [&:active]:cursor-grabbing">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-7 h-7 rounded"
              style={{ backgroundColor: isEnabled ? config.bgColor : 'gray' }}
            >
              <config.icon className="w-5 h-5 text-white" />
            </div>
            {isEditing ? (
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value.slice(0, 18))}
                onBlur={handleNameSubmit}
                onKeyDown={handleNameKeyDown}
                autoFocus
                className="font-medium text-md bg-transparent border-none outline-none p-0 w-[180px]"
                maxLength={18}
              />
            ) : (
              <span
                className={cn(
                  'font-medium text-md hover:text-muted-foreground cursor-text truncate',
                  !isEnabled ? (isWide ? 'max-w-[200px]' : 'max-w-[100px]') : 'max-w-[180px]'
                )}
                onClick={handleNameClick}
                title={name}
              >
                {name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEnabled && (
              <Badge variant="secondary" className="bg-gray-100 text-gray-500 hover:bg-gray-100">
                Disabled
              </Badge>
            )}
            {/* Schedule indicator badge - displayed for starter blocks with active schedules */}
            {showScheduleIndicator && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="flex items-center gap-1 text-green-600 bg-green-50 border-green-200 hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400 font-normal text-xs"
                  >
                    <div className="relative flex items-center justify-center mr-0.5">
                      <div className="absolute h-3 w-3 rounded-full bg-green-500/20"></div>
                      <div className="relative h-2 w-2 rounded-full bg-green-500"></div>
                    </div>
                    Scheduled
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] p-4">
                  {scheduleInfo ? (
                    <>
                      <p className="text-sm">{scheduleInfo.scheduleTiming}</p>
                      {scheduleInfo.nextRunAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Next run: {formatDateTime(new Date(scheduleInfo.nextRunAt), scheduleInfo.timezone)}
                        </p>
                      )}
                      {scheduleInfo.lastRanAt && (
                        <p className="text-xs text-muted-foreground">
                          Last run: {formatDateTime(new Date(scheduleInfo.lastRanAt), scheduleInfo.timezone)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
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
                    variant="outline"
                    className="flex items-center gap-1 text-green-600 bg-green-50 border-green-200 hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400 font-normal text-xs"
                  >
                    <div className="relative flex items-center justify-center mr-0.5">
                      <div className="absolute h-3 w-3 rounded-full bg-green-500/20"></div>
                      <div className="relative h-2 w-2 rounded-full bg-green-500"></div>
                    </div>
                    Webhook
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] p-4">
                  {webhookInfo ? (
                    <>
                      <p className="text-sm">{getProviderName(webhookInfo.provider)} Webhook</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Path: {webhookInfo.webhookPath}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {config.longDescription && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-gray-500 p-1 h-7">
                    <Info className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] p-4">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium mb-1">Description</p>
                      <p className="text-sm text-muted-foreground">{config.longDescription}</p>
                    </div>
                    {config.outputs && (
                      <div>
                        <p className="text-sm font-medium mb-1">Output</p>
                        <div className="text-sm">
                          {Object.entries(config.outputs).map(([key, value]) => (
                            <div key={key} className="mb-1">
                              <span className="text-muted-foreground">{key}</span>{' '}
                              {typeof value.type === 'object' ? (
                                <div className="pl-3 mt-1">
                                  {Object.entries(value.type).map(([typeKey, typeValue]) => (
                                    <div key={typeKey} className="flex items-start">
                                      <span className="text-blue-500 font-medium">{typeKey}:</span>
                                      <span className="text-green-500 ml-1">
                                        {typeValue as string}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-green-500">{value.type as string}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleBlockWide(id)}
                  className="text-gray-500 p-1 h-7"
                >
                  {isWide ? (
                    <RectangleHorizontal className="h-5 w-5" />
                  ) : (
                    <RectangleVertical className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{isWide ? 'Narrow Block' : 'Expand Block'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Block Content */}
        <div ref={contentRef} className="px-4 pt-3 pb-4 space-y-4 cursor-pointer">
          {subBlockRows.length > 0
            ? subBlockRows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="flex gap-4">
                  {row.map((subBlock, blockIndex) => (
                    <div
                      key={`${id}-${rowIndex}-${blockIndex}`}
                      className={cn('space-y-1', subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                    >
                      <SubBlock blockId={id} config={subBlock} isConnecting={isConnecting} />
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
              type="source"
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id="source"
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
              data-handleid="source"
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => true}
            />

            {/* Error Handle - Don't show for starter blocks */}
            {type !== 'starter' && (
              <Handle
                type="source"
                position={horizontalHandles ? Position.Right : Position.Bottom}
                id="error"
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
                data-handleid="error"
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => true}
              />
            )}
          </>
        )}
      </Card>
    </div>
  )
}
