import { BulkActionButton, cn, Tooltip } from '@sim/emcn'
import { Ban, Circle, Trash } from '@sim/emcn/icons'
import { domAnimation, LazyMotion, m } from 'framer-motion'
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
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className={cn('-translate-x-1/2 fixed bottom-6 left-1/2 z-[var(--z-dropdown)]', className)}
      >
        <div className='flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
          <span className='px-1 text-[var(--text-secondary)] text-small'>
            {isAllSelected ? totalCount : selectedCount} selected
            {showSelectAllOption && (
              <>
                {' · '}
                <button
                  type='button'
                  onClick={onSelectAll}
                  className='text-[var(--brand-secondary)] hover-hover:underline'
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
                  className='text-[var(--brand-secondary)] hover-hover:underline'
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
                  <BulkActionButton aria-label='Enable' onClick={onEnable} disabled={isLoading}>
                    <Circle className='size-[12px]' />
                  </BulkActionButton>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Enable</Tooltip.Content>
              </Tooltip.Root>
            )}

            {showDisableButton && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <BulkActionButton aria-label='Disable' onClick={onDisable} disabled={isLoading}>
                    <Ban className='size-[12px]' />
                  </BulkActionButton>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Disable</Tooltip.Content>
              </Tooltip.Root>
            )}

            {onDelete && canEdit && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <BulkActionButton aria-label='Delete' onClick={onDelete} disabled={isLoading}>
                    <Trash className='size-[12px]' />
                  </BulkActionButton>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Delete</Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>
        </div>
      </m.div>
    </LazyMotion>
  )
}
