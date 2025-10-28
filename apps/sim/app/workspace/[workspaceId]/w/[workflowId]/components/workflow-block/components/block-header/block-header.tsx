import { useEffect, useRef, useState } from 'react'
import { BookOpen, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, validateName } from '@/lib/utils'
import type { BlockConfig } from '@/blocks/types'
import { MAX_BLOCK_NAME_LENGTH } from '../../constants'
import type { ScheduleInfo } from '../../types'
import { getProviderName } from '../../utils'

interface BlockHeaderProps {
  blockId: string
  config: BlockConfig
  name: string
  isEnabled: boolean
  isDiffMode: boolean
  canEdit: boolean
  isOfflineMode: boolean
  shouldShowScheduleBadge: boolean
  scheduleInfo: ScheduleInfo | null
  showWebhookIndicator: boolean
  webhookProvider?: string
  webhookPath?: string
  childWorkflowId?: string
  childIsDeployed: boolean
  childActiveVersion: number | null
  isLoadingChildVersion: boolean
  onUpdateName: (name: string) => void
  onReactivateSchedule: (scheduleId: string) => void
  onDisableSchedule: (scheduleId: string) => void
}

/**
 * Component for the block header with name, icon, badges, and controls
 */
export function BlockHeader({
  blockId,
  config,
  name,
  isEnabled,
  isDiffMode,
  canEdit,
  isOfflineMode,
  shouldShowScheduleBadge,
  scheduleInfo,
  showWebhookIndicator,
  webhookProvider,
  webhookPath,
  childWorkflowId,
  childIsDeployed,
  childActiveVersion,
  isLoadingChildVersion,
  onUpdateName,
  onReactivateSchedule,
  onDisableSchedule,
}: BlockHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditedName(name)
    setIsEditing(true)
  }

  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [isEditing])

  const handleNodeNameChange = (newName: string) => {
    const validatedName = validateName(newName)
    setEditedName(validatedName.slice(0, MAX_BLOCK_NAME_LENGTH))
  }

  const handleNameSubmit = () => {
    const trimmedName = editedName.trim().slice(0, MAX_BLOCK_NAME_LENGTH)
    if (trimmedName && trimmedName !== name) {
      onUpdateName(trimmedName)
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

  const isReadOnly = !canEdit && !isDiffMode

  return (
    <div
      className='workflow-drag-handle flex cursor-grab items-center justify-between p-3 [&:active]:cursor-grabbing'
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
              maxLength={MAX_BLOCK_NAME_LENGTH}
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
                maxWidth: !isEnabled ? '140px' : '180px',
              }}
            >
              {name}
            </span>
          )}
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-2'>
        {/* Badges */}
        <div className='flex flex-shrink-0 items-center gap-2'>
          {/* Child Workflow Deployment Indicator */}
          {childWorkflowId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className='relative mr-1 flex items-center justify-center'>
                  <div
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      childIsDeployed ? 'bg-green-500' : 'bg-red-500'
                    )}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side='top' className='px-3 py-2'>
                <span className='text-sm'>
                  {childIsDeployed
                    ? isLoadingChildVersion
                      ? 'Deployed'
                      : childActiveVersion != null
                        ? `Deployed (v${childActiveVersion})`
                        : 'Deployed'
                    : 'Not Deployed'}
                </span>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Disabled Badge */}
          {!isEnabled && (
            <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
              Disabled
            </Badge>
          )}

          {/* Schedule Badge */}
          {shouldShowScheduleBadge && scheduleInfo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant='outline'
                  className={cn(
                    'flex cursor-pointer items-center gap-1 font-normal text-xs',
                    scheduleInfo.isDisabled
                      ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
                      : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400'
                  )}
                  onClick={
                    scheduleInfo.id
                      ? scheduleInfo.isDisabled
                        ? () => onReactivateSchedule(scheduleInfo.id!)
                        : () => onDisableSchedule(scheduleInfo.id!)
                      : undefined
                  }
                >
                  <div className='relative mr-0.5 flex items-center justify-center'>
                    <div
                      className={cn(
                        'absolute h-3 w-3 rounded-full',
                        scheduleInfo.isDisabled ? 'bg-amber-500/20' : 'bg-green-500/20'
                      )}
                    />
                    <div
                      className={cn(
                        'relative h-2 w-2 rounded-full',
                        scheduleInfo.isDisabled ? 'bg-amber-500' : 'bg-green-500'
                      )}
                    />
                  </div>
                  {scheduleInfo.isDisabled ? 'Disabled' : 'Scheduled'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side='top' className='max-w-[300px] p-4'>
                {scheduleInfo.isDisabled ? (
                  <p className='text-sm'>
                    This schedule is currently disabled. Click the badge to reactivate it.
                  </p>
                ) : (
                  <p className='text-sm'>Click the badge to disable this schedule.</p>
                )}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Webhook Badge */}
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
                {webhookProvider && webhookPath ? (
                  <>
                    <p className='text-sm'>{getProviderName(webhookProvider)} Webhook</p>
                    <p className='mt-1 text-muted-foreground text-xs'>Path: {webhookPath}</p>
                  </>
                ) : (
                  <p className='text-muted-foreground text-sm'>
                    This workflow is triggered by a webhook.
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Controls */}
        <>
          {/* Documentation Button */}
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
                    {config.outputs && Object.keys(config.outputs).length > 0 && (
                      <div>
                        <p className='mb-1 font-medium text-sm'>Output</p>
                        <div className='text-sm'>
                          {Object.entries(config.outputs).map(([key, value]) => (
                            <div key={key} className='mb-1'>
                              <span className='text-muted-foreground'>{key}</span>{' '}
                              {typeof value === 'object' && value !== null && 'type' in value ? (
                                <span className='text-green-500'>{value.type}</span>
                              ) : typeof value === 'object' && value !== null ? (
                                <div className='mt-1 pl-3'>
                                  {Object.entries(value).map(([typeKey, typeValue]) => (
                                    <div key={typeKey} className='flex items-start'>
                                      <span className='font-medium text-blue-500'>{typeKey}:</span>
                                      <span className='ml-1 text-green-500'>
                                        {typeValue as string}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className='text-green-500'>{value as string}</span>
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
        </>
      </div>
    </div>
  )
}
