'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipTag,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@sim/emcn'
import {
  Circle,
  CircleAlert,
  CirclePause,
  CornerUpRight,
  FileText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SendToBack,
} from '@sim/emcn/icons'
import { formatDateTime, formatRelativeTime } from '@sim/utils/formatting'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { VersionDescriptionModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/version-description-modal'
import { formatVersionLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label'
import { useUpdateDeploymentVersion } from '@/hooks/queries/deployments'

interface VersionsProps {
  workflowId: string | null
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  isPromotingVersion: boolean
  onSelectVersion: (version: number) => void
  onPromoteToLive: (version: number) => void
  onLoadDeployment: (version: number) => void
}

/** Displays compact deployment history with detail and management actions. */
export function Versions({
  workflowId,
  versions,
  versionsLoading,
  isPromotingVersion,
  onSelectVersion,
  onPromoteToLive,
  onLoadDeployment,
}: VersionsProps) {
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
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
    setEditingVersion(version)
    setEditValue(currentName || `v${version}`)
  }

  const handleSaveRename = (version: number) => {
    if (renameMutation.isPending) return
    if (!workflowId || !editValue.trim()) {
      setEditingVersion(null)
      return
    }

    const currentVersion = versions.find((candidate) => candidate.version === version)
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
        onSuccess: () => setEditingVersion(null),
      }
    )
  }

  const handleCancelRename = () => {
    setEditingVersion(null)
    setEditValue('')
  }

  const descriptionModalVersionData =
    descriptionModalVersion === null
      ? null
      : versions.find((version) => version.version === descriptionModalVersion)
  const orderedVersions = [...versions].sort((first, second) => {
    if (first.isActive !== second.isActive) return first.isActive ? -1 : 1
    return second.version - first.version
  })

  return (
    <div className='relative'>
      {(versions.length > 0 || versionsLoading) && (
        <div
          aria-hidden='true'
          className='absolute top-[18px] bottom-9 left-[13px] w-px bg-[var(--border)]'
        />
      )}

      {versionsLoading &&
        versions.length === 0 &&
        [0, 1].map((index) => (
          <div key={index} className='relative flex min-h-[54px] items-start gap-1'>
            <span className='relative z-10 mt-1 flex size-7 shrink-0 items-center justify-center bg-[var(--popover-surface)]'>
              <Skeleton className='size-[14px] rounded-full' />
            </span>
            <div className='min-w-0 flex-1 space-y-1.5 px-2 py-2'>
              <Skeleton className='h-3 w-24' />
              <Skeleton className='h-2.5 w-40' />
            </div>
            <Skeleton className='mt-1 size-7 rounded-sm' />
          </div>
        ))}

      {orderedVersions.map((version) => {
        const operationStatus =
          !version.isActive && version.latestOperationStatus !== 'active'
            ? version.latestOperationStatus
            : null
        const isOperationPending =
          operationStatus === 'preparing' || operationStatus === 'activating'
        const TimelineIcon = version.isActive
          ? CornerUpRight
          : isOperationPending
            ? CirclePause
            : operationStatus === 'failed'
              ? CircleAlert
              : Circle
        const deploymentVerb = version.isActive ? 'Promoted' : 'Deployed'
        const versionLabel = formatVersionLabel(version.version, version.name)

        return (
          <div key={version.id} className='group relative flex min-h-[54px] items-start gap-1'>
            <span className='relative z-10 mt-1 flex size-7 shrink-0 items-center justify-center bg-[var(--popover-surface)]'>
              <TimelineIcon
                className={
                  version.isActive
                    ? 'size-[14px] translate-x-1 text-[var(--text-primary)]'
                    : operationStatus === 'failed'
                      ? 'size-[14px] text-red-500'
                      : 'size-[14px] text-[var(--text-icon)]'
                }
                aria-hidden='true'
              />
            </span>

            <div className='flex min-w-0 flex-1 items-start rounded-sm p-1 transition-colors duration-100 hover-hover:bg-[var(--surface-4)]'>
              {editingVersion === version.version ? (
                <div className='min-w-0 flex-1 p-1'>
                  <ChipInput
                    ref={inputRef}
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleSaveRename(version.version)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        handleCancelRename()
                      }
                    }}
                    onBlur={() => handleSaveRename(version.version)}
                    className='w-full'
                    inputClassName='font-medium'
                    maxLength={100}
                    disabled={renameMutation.isPending}
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck='false'
                    aria-label={`Rename ${versionLabel}`}
                  />
                </div>
              ) : (
                <button
                  type='button'
                  className='min-w-0 flex-1 rounded-sm p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
                  onClick={() => onSelectVersion(version.version)}
                >
                  <span className='block min-w-0'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                        {versionLabel}
                      </span>
                      {version.isActive && <ChipTag variant='gray'>Live</ChipTag>}
                      {(isOperationPending || operationStatus === 'failed') && (
                        <ChipTag variant={operationStatus === 'failed' ? 'red' : 'amber'}>
                          {operationStatus === 'failed' ? 'Failed' : 'Pending'}
                        </ChipTag>
                      )}
                    </span>
                    <span
                      className='mt-0.5 block truncate text-[var(--text-muted)] text-xs'
                      title={formatDateTime(new Date(version.createdAt))}
                    >
                      {deploymentVerb} {formatRelativeTime(version.createdAt)} by{' '}
                      {version.deployedBy || 'Unknown'}
                    </span>
                  </span>
                </button>
              )}

              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Chip
                    type='button'
                    leftIcon={MoreHorizontal}
                    className='mr-1 shrink-0'
                    disabled={isPromotingVersion}
                    aria-label={`Manage ${versionLabel}`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' sideOffset={4}>
                  <DropdownMenuItem
                    onSelect={() => handleStartRename(version.version, version.name)}
                  >
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDescriptionModalVersion(version.version)}>
                    <FileText />
                    {version.description ? 'Edit description' : 'Add description'}
                  </DropdownMenuItem>
                  {!version.isActive && (
                    <DropdownMenuItem onSelect={() => onPromoteToLive(version.version)}>
                      <RefreshCw />
                      Promote to live
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => onLoadDeployment(version.version)}>
                    <SendToBack />
                    Restore as draft
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}

      {workflowId && descriptionModalVersionData && (
        <VersionDescriptionModal
          key={descriptionModalVersionData.version}
          open={descriptionModalVersion !== null}
          onOpenChange={(nextOpen) => !nextOpen && setDescriptionModalVersion(null)}
          workflowId={workflowId}
          version={descriptionModalVersionData.version}
          versionName={formatVersionLabel(
            descriptionModalVersionData.version,
            descriptionModalVersionData.name
          )}
          currentDescription={descriptionModalVersionData.description}
        />
      )}
    </div>
  )
}
