import { motion } from 'framer-motion'
import { Circle, CircleOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/components/providers/workspace-permissions-provider'

interface ActionBarProps {
  selectedCount: number
  onEnable?: () => void
  onDisable?: () => void
  onDelete?: () => void
  enabledCount?: number
  disabledCount?: number
  isLoading?: boolean
  className?: string
}

export function ActionBar({
  selectedCount,
  onEnable,
  onDisable,
  onDelete,
  enabledCount = 0,
  disabledCount = 0,
  isLoading = false,
  className,
}: ActionBarProps) {
  const userPermissions = useUserPermissionsContext()

  if (selectedCount === 0) return null

  const canEdit = userPermissions.canEdit
  const showEnableButton = disabledCount > 0 && onEnable && canEdit
  const showDisableButton = enabledCount > 0 && onDisable && canEdit

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className={cn('-translate-x-1/2 fixed bottom-6 left-1/2 z-50 transform', className)}
    >
      <div className='flex items-center gap-3 rounded-lg border border-gray-200 bg-background px-4 py-2 shadow-sm dark:border-gray-800'>
        <span className='text-gray-500 text-sm'>{selectedCount} selected</span>

        <div className='h-4 w-px bg-gray-200 dark:bg-gray-800' />

        <div className='flex items-center gap-1'>
          {showEnableButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onEnable}
                  disabled={isLoading}
                  className='text-gray-500 hover:text-gray-700'
                >
                  <Circle className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>
                Enable {disabledCount > 1 ? `${disabledCount} items` : 'item'}
              </TooltipContent>
            </Tooltip>
          )}

          {showDisableButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onDisable}
                  disabled={isLoading}
                  className='text-gray-500 hover:text-gray-700'
                >
                  <CircleOff className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>
                Disable {enabledCount > 1 ? `${enabledCount} items` : 'item'}
              </TooltipContent>
            </Tooltip>
          )}

          {onDelete && canEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onDelete}
                  disabled={isLoading}
                  className='text-gray-500 hover:text-red-600'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>Delete items</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </motion.div>
  )
}
