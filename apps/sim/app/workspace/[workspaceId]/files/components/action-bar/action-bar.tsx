'use client'

import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion'
import {
  Button,
  Download,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Folder,
  Tooltip,
  Trash2,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/files/move-options'
import { renderMoveOption } from '@/app/workspace/[workspaceId]/files/move-options'

interface FilesActionBarProps {
  selectedCount: number
  onDownload?: () => void
  onMove?: (optionValue: string) => void
  moveOptions?: MoveOptionNode[]
  onDelete?: () => void
  isLoading?: boolean
  className?: string
}

export function FilesActionBar({
  selectedCount,
  onDownload,
  onMove,
  moveOptions,
  onDelete,
  isLoading = false,
  className,
}: FilesActionBarProps) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {selectedCount > 0 && (
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className={cn(
              '-translate-x-1/2 fixed bottom-6 left-1/2 z-[var(--z-dropdown)] transform',
              className
            )}
          >
            <div className='flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
              <span className='px-1 text-[var(--text-secondary)] text-small'>
                {selectedCount} selected
              </span>
              <div className='flex items-center gap-[5px]'>
                {onDownload && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={onDownload}
                        disabled={isLoading}
                        className='hover-hover:!text-[var(--text-inverse)] size-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                      >
                        <Download className='size-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>Download</Tooltip.Content>
                  </Tooltip.Root>
                )}
                {onMove && moveOptions && (
                  <DropdownMenu>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='ghost'
                            disabled={isLoading}
                            className='hover-hover:!text-[var(--text-inverse)] size-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                          >
                            <Folder className='size-[12px]' />
                          </Button>
                        </DropdownMenuTrigger>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>Move</Tooltip.Content>
                    </Tooltip.Root>
                    <DropdownMenuContent
                      side='top'
                      align='center'
                      className='max-h-[240px] overflow-y-auto'
                    >
                      {moveOptions.length > 0 && (
                        <DropdownMenuItem onSelect={() => onMove(moveOptions[0].value)}>
                          <Folder />
                          {moveOptions[0].label}
                        </DropdownMenuItem>
                      )}
                      {moveOptions.length > 1 && <DropdownMenuSeparator />}
                      {moveOptions.slice(1).map((option) => renderMoveOption(option, onMove))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {onDelete && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={onDelete}
                        disabled={isLoading}
                        className='hover-hover:!text-[var(--text-inverse)] size-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                      >
                        <Trash2 className='size-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>Delete</Tooltip.Content>
                  </Tooltip.Root>
                )}
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  )
}
