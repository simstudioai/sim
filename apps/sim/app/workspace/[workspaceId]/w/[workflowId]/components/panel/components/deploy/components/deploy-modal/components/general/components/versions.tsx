'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { MoreVertical, Pencil, RotateCcw, SendToBack } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverItem, PopoverTrigger } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'

const logger = createLogger('Versions')

/** Shared styling constants aligned with terminal component */
const HEADER_TEXT_CLASS = 'font-medium text-[var(--text-tertiary)] text-[12px]'
const ROW_TEXT_CLASS = 'font-medium text-[var(--text-primary)] text-[12px]'
const COLUMN_BASE_CLASS = 'flex-shrink-0'

/** Column width configuration */
const COLUMN_WIDTHS = {
  VERSION: 'w-[180px]',
  DEPLOYED_BY: 'w-[140px]',
  TIMESTAMP: 'flex-1',
  ACTIONS: 'w-[32px]',
} as const

interface VersionsProps {
  workflowId: string | null
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  selectedVersion: number | null
  onSelectVersion: (version: number | null) => void
  onPromoteToLive: (version: number) => void
  onLoadDeployment: (version: number) => void
  fetchVersions: () => Promise<void>
}

/**
 * Formats a timestamp into a readable string.
 * @param value - The date string or Date object to format
 * @returns Formatted string like "8:36 PM PT on Oct 11, 2025"
 */
const formatDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })

  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return `${timePart} on ${datePart}`
}

/**
 * Displays a list of workflow deployment versions with actions
 * for viewing, promoting to live, renaming, and loading deployments.
 */
export function Versions({
  workflowId,
  versions,
  versionsLoading,
  selectedVersion,
  onSelectVersion,
  onPromoteToLive,
  onLoadDeployment,
  fetchVersions,
}: VersionsProps) {
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingVersion !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingVersion])

  const handleStartRename = (version: number, currentName: string | null | undefined) => {
    setOpenDropdown(null)
    setEditingVersion(version)
    setEditValue(currentName || `v${version}`)
  }

  const handleSaveRename = async (version: number) => {
    if (!workflowId || !editValue.trim()) {
      setEditingVersion(null)
      return
    }

    const currentVersion = versions.find((v) => v.version === version)
    const currentName = currentVersion?.name || `v${version}`

    if (editValue.trim() === currentName) {
      setEditingVersion(null)
      return
    }

    setIsRenaming(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editValue.trim() }),
      })

      if (res.ok) {
        await fetchVersions()
        setEditingVersion(null)
      } else {
        logger.error('Failed to rename version')
      }
    } catch (error) {
      logger.error('Error renaming version:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelRename = () => {
    setEditingVersion(null)
    setEditValue('')
  }

  const handleRowClick = (version: number) => {
    if (editingVersion === version) return
    onSelectVersion(selectedVersion === version ? null : version)
  }

  const handlePromote = (version: number) => {
    setOpenDropdown(null)
    onPromoteToLive(version)
  }

  const handleLoadDeployment = (version: number) => {
    setOpenDropdown(null)
    onLoadDeployment(version)
  }

  if (versionsLoading && versions.length === 0) {
    return (
      <div className='overflow-hidden rounded-[4px] border border-[var(--border)]'>
        <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-[16px]'>
          <div className={clsx(COLUMN_WIDTHS.VERSION, COLUMN_BASE_CLASS)}>
            <Skeleton className='h-[12px] w-[50px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.DEPLOYED_BY, COLUMN_BASE_CLASS)}>
            <Skeleton className='h-[12px] w-[76px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
            <Skeleton className='h-[12px] w-[68px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.ACTIONS, COLUMN_BASE_CLASS)} />
        </div>
        <div className='bg-[var(--surface-2)]'>
          {[0, 1].map((i) => (
            <div key={i} className='flex h-[36px] items-center px-[16px]'>
              <div className={clsx(COLUMN_WIDTHS.VERSION, COLUMN_BASE_CLASS, 'min-w-0 pr-[8px]')}>
                <div className='flex items-center gap-[16px]'>
                  <Skeleton className='h-[6px] w-[6px] rounded-[2px]' />
                  <Skeleton className='h-[12px] w-[60px]' />
                </div>
              </div>
              <div className={clsx(COLUMN_WIDTHS.DEPLOYED_BY, COLUMN_BASE_CLASS, 'min-w-0')}>
                <Skeleton className='h-[12px] w-[80px]' />
              </div>
              <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
                <Skeleton className='h-[12px] w-[160px]' />
              </div>
              <div className={clsx(COLUMN_WIDTHS.ACTIONS, COLUMN_BASE_CLASS, 'flex justify-end')}>
                <Skeleton className='h-[20px] w-[20px] rounded-[4px]' />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className='flex h-[120px] items-center justify-center rounded-[4px] border border-[var(--border)] text-[#8D8D8D] text-[13px]'>
        No deployments yet
      </div>
    )
  }

  return (
    <div className='overflow-hidden rounded-[4px] border border-[var(--border)]'>
      <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-[16px]'>
        <div className={clsx(COLUMN_WIDTHS.VERSION, COLUMN_BASE_CLASS)}>
          <span className={HEADER_TEXT_CLASS}>Version</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.DEPLOYED_BY, COLUMN_BASE_CLASS)}>
          <span className={HEADER_TEXT_CLASS}>Deployed by</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
          <span className={HEADER_TEXT_CLASS}>Timestamp</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.ACTIONS, COLUMN_BASE_CLASS)} />
      </div>

      <div className='bg-[var(--surface-2)]'>
        {versions.map((v) => {
          const isSelected = selectedVersion === v.version

          return (
            <div
              key={v.id}
              className={clsx(
                'flex h-[36px] cursor-pointer items-center px-[16px] transition-colors duration-100',
                isSelected
                  ? 'bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15'
                  : 'hover:bg-[var(--surface-6)] dark:hover:bg-[var(--border)]'
              )}
              onClick={() => handleRowClick(v.version)}
            >
              <div className={clsx(COLUMN_WIDTHS.VERSION, COLUMN_BASE_CLASS, 'min-w-0 pr-[8px]')}>
                <div className='flex items-center gap-[16px]'>
                  <div
                    className={clsx(
                      'h-[6px] w-[6px] shrink-0 rounded-[2px]',
                      v.isActive ? 'bg-[#4ADE80]' : 'bg-[#B7B7B7]'
                    )}
                    title={v.isActive ? 'Live' : 'Inactive'}
                  />
                  {editingVersion === v.version ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleSaveRename(v.version)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          handleCancelRename()
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => handleSaveRename(v.version)}
                      className={clsx(
                        'w-full border-0 bg-transparent p-0 font-medium text-[12px] leading-5 outline-none',
                        'text-[var(--text-primary)] focus:outline-none focus:ring-0'
                      )}
                      maxLength={100}
                      disabled={isRenaming}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck='false'
                    />
                  ) : (
                    <span
                      className={clsx('block flex items-center gap-[4px] truncate', ROW_TEXT_CLASS)}
                    >
                      <span className='truncate'>{v.name || `v${v.version}`}</span>
                      {v.isActive && <span className='text-[var(--text-tertiary)]'> (live)</span>}
                      {isSelected && (
                        <span className='text-[var(--text-tertiary)]'> (selected)</span>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className={clsx(COLUMN_WIDTHS.DEPLOYED_BY, COLUMN_BASE_CLASS, 'min-w-0')}>
                <span
                  className={clsx('block truncate text-[var(--text-tertiary)]', ROW_TEXT_CLASS)}
                >
                  {v.deployedBy || 'Unknown'}
                </span>
              </div>

              <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
                <span
                  className={clsx('block truncate text-[var(--text-tertiary)]', ROW_TEXT_CLASS)}
                >
                  {formatDate(v.createdAt)}
                </span>
              </div>

              <div
                className={clsx(COLUMN_WIDTHS.ACTIONS, COLUMN_BASE_CLASS, 'flex justify-end')}
                onClick={(e) => e.stopPropagation()}
              >
                <Popover
                  open={openDropdown === v.version}
                  onOpenChange={(open) => setOpenDropdown(open ? v.version : null)}
                >
                  <PopoverTrigger asChild>
                    <Button variant='ghost' className='!p-1'>
                      <MoreVertical className='h-3.5 w-3.5' />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align='end' sideOffset={4} minWidth={160} maxWidth={200} border>
                    <PopoverItem onClick={() => handleStartRename(v.version, v.name)}>
                      <Pencil className='h-3 w-3' />
                      <span>Rename</span>
                    </PopoverItem>
                    {!v.isActive && (
                      <PopoverItem onClick={() => handlePromote(v.version)}>
                        <RotateCcw className='h-3 w-3' />
                        <span>Promote to live</span>
                      </PopoverItem>
                    )}
                    <PopoverItem onClick={() => handleLoadDeployment(v.version)}>
                      <SendToBack className='h-3 w-3' />
                      <span>Load deployment</span>
                    </PopoverItem>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
