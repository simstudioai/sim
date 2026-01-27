import { motion } from 'framer-motion'
import { Circle, CircleOff } from 'lucide-react'
import { Button, Tooltip, Trash2 } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

interface ActionBarProps {
  selectedCount: number
  onEnable?: () => void
  onDisable?: () => void
  onDelete?: () => void
  enabledCount?: number
  disabledCount?: number
  isLoading?: boolean
  className?: string
  totalCount?: number
  isAllPageSelected?: boolean
  isAllSelected?: boolean
  onSelectAll?: () => void
  onClearSelectAll?: () => void
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
  totalCount = 0,
  isAllPageSelected = false,
  isAllSelected = false,
  onSelectAll,
  onClearSelectAll,
}: ActionBarProps) {
  const userPermissions = useUserPermissionsContext()

  if (selectedCount === 0 && !isAllSelected) return null

  const canEdit = userPermissions.canEdit
  const showEnableButton = disabledCount > 0 && onEnable && canEdit
  const showDisableButton = enabledCount > 0 && onDisable && canEdit
  const showSelectAllOption =
    isAllPageSelected && !isAllSelected && totalCount > selectedCount && onSelectAll

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className={cn('-translate-x-1/2 fixed bottom-6 left-1/2 z-50 transform', className)}
    >
      <div className='flex items-center gap-[8px] rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-[8px] py-[6px]'>
        <span className='px-[4px] text-[13px] text-[var(--text-secondary)]'>
          {isAllSelected ? totalCount : selectedCount} selected
          {showSelectAllOption && (
            <>
              {' · '}
              <button
                type='button'
                onClick={onSelectAll}
                className='text-[var(--brand-primary)] hover:underline'
              >
                Select all
              </button>
            </>
          )}
          {isAllSelected && onClearSelectAll && (
            <>
              {' · '}
              <button
                type='button'
                onClick={onClearSelectAll}
                className='text-[var(--brand-primary)] hover:underline'
              >
                Clear
              </button>
            </>
          )}
        </span>

        <div className='flex items-center gap-[5px]'>
          {showEnableButton && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={onEnable}
                  disabled={isLoading}
                  className='hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-[8px] bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                >
                  <Circle className='h-[12px] w-[12px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Enable</Tooltip.Content>
            </Tooltip.Root>
          )}

          {showDisableButton && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={onDisable}
                  disabled={isLoading}
                  className='hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-[8px] bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                >
                  <CircleOff className='h-[12px] w-[12px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Disable</Tooltip.Content>
            </Tooltip.Root>
          )}

          {onDelete && canEdit && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={onDelete}
                  disabled={isLoading}
                  className='hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-[8px] bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                >
                  <Trash2 className='h-[12px] w-[12px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Delete</Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
      </div>
    </motion.div>
  )
}
