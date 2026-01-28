'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { FileText, MoreVertical, Pencil, RotateCcw, SendToBack } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/core/utils/formatting'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { useUpdateDeploymentVersion } from '@/hooks/queries/deployments'
import { VersionDescriptionModal } from './version-description-modal'

const HEADER_TEXT_CLASS = 'font-medium text-[var(--text-tertiary)] text-[12px]'
const ROW_TEXT_CLASS = 'font-medium text-[var(--text-primary)] text-[12px]'
const COLUMN_BASE_CLASS = 'flex-shrink-0'

const COLUMN_WIDTHS = {
  VERSION: 'w-[180px]',
  DEPLOYED_BY: 'w-[140px]',
  TIMESTAMP: 'flex-1',
  ACTIONS: 'w-[56px]',
} as const

interface VersionsProps {
  workflowId: string | null
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  selectedVersion: number | null
  onSelectVersion: (version: number | null) => void
  onPromoteToLive: (version: number) => void
  onLoadDeployment: (version: number) => void
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
}: VersionsProps) {
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [descriptionModalVersion, setDescriptionModalVersion] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const renameMutation = useUpdateDeploymentVersion()

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

  const handleSaveRename = (version: number) => {
    if (renameMutation.isPending) return
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

    renameMutation.mutate(
      {
        workflowId,
        version,
        name: editValue.trim(),
      },
      {
        onSuccess: () => {
          setEditingVersion(null)
        },
        onError: () => {
          // Keep editing state open on error so user can retry
        },
      }
    )
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

  const handleOpenDescriptionModal = (version: number) => {
    setOpenDropdown(null)
    setDescriptionModalVersion(version)
  }

  const descriptionModalVersionData =
    descriptionModalVersion !== null
      ? versions.find((v) => v.version === descriptionModalVersion)
      : null

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
              <div
                className={clsx(
                  COLUMN_WIDTHS.ACTIONS,
                  COLUMN_BASE_CLASS,
                  'flex justify-end gap-[2px]'
                )}
              >
                <Skeleton className='h-[20px] w-[20px] rounded-[4px]' />
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
                      disabled={renameMutation.isPending}
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
                  {formatDateTime(new Date(v.createdAt))}
                </span>
              </div>

              <div
                className={clsx(
                  COLUMN_WIDTHS.ACTIONS,
                  COLUMN_BASE_CLASS,
                  'flex items-center justify-end gap-[2px]'
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      className={clsx(
                        '!p-1',
                        !v.description &&
                          'text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]'
                      )}
                      onClick={() => handleOpenDescriptionModal(v.version)}
                    >
                      <FileText className='h-3.5 w-3.5' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top' className='max-w-[240px]'>
                    {v.description ? (
                      <p className='line-clamp-3 text-[12px]'>{v.description}</p>
                    ) : (
                      <p className='text-[12px]'>Add description</p>
                    )}
                  </Tooltip.Content>
                </Tooltip.Root>
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
                    <PopoverItem onClick={() => handleOpenDescriptionModal(v.version)}>
                      <FileText className='h-3 w-3' />
                      <span>{v.description ? 'Edit description' : 'Add description'}</span>
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

      {workflowId && descriptionModalVersionData && (
        <VersionDescriptionModal
          key={descriptionModalVersionData.version}
          open={descriptionModalVersion !== null}
          onOpenChange={(open) => !open && setDescriptionModalVersion(null)}
          workflowId={workflowId}
          version={descriptionModalVersionData.version}
          versionName={
            descriptionModalVersionData.name || `v${descriptionModalVersionData.version}`
          }
          currentDescription={descriptionModalVersionData.description}
        />
      )}
    </div>
  )
}
