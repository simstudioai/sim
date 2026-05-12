'use client'

import { domAnimation, LazyMotion, m } from 'framer-motion'
import { Button, Download, Tooltip, Trash2 } from '@/components/emcn'
import { Folder } from '@/components/emcn/icons'

interface FilesActionBarProps {
  selectedCount: number
  onDownload?: () => void
  onMove?: () => void
  onDelete?: () => void
  isLoading?: boolean
}

export function FilesActionBar({
  selectedCount,
  onDownload,
  onMove,
  onDelete,
  isLoading = false,
}: FilesActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className='-translate-x-1/2 fixed bottom-6 left-1/2 z-50 transform'
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
            {onMove && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={onMove}
                    disabled={isLoading}
                    className='hover-hover:!text-[var(--text-inverse)] size-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                  >
                    <Folder className='size-[12px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Move</Tooltip.Content>
              </Tooltip.Root>
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
    </LazyMotion>
  )
}
